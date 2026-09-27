// Drives the app inside the emulator's WebView over the raw DevTools protocol:
// waits for the demo stream, opens the dispatcher and saves screenshots and a report.
import WebSocket from "ws";
import { writeFileSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 30 && !target; i++) {
  try {
    const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
    target = targets.find((t) => t.type === "page");
  } catch {}
  if (!target) await sleep(1000);
}
if (!target) throw new Error("No WebView page to inspect");

const ws = new WebSocket(target.webSocketDebuggerUrl);
const closed = new Promise((resolve) => ws.once("close", resolve));
await new Promise((resolve, reject) =>
  ws.once("open", resolve).once("error", reject),
);

let nextId = 0;
const pending = new Map(),
  errors = [];

ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(d.exception?.description ?? d.text);
  }
});

let alive = true;
closed.then(() => {
  alive = false;
  for (const reply of pending.values()) {
    reply({ error: { message: "WebView connection closed" } });
  }
  pending.clear();
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    if (!alive) {
      return reject(new Error(`${method}: WebView connection closed`));
    }

    const id = ++nextId;
    pending.set(id, (m) =>
      m.error
        ? reject(new Error(`${method}: ${m.error.message}`))
        : resolve(m.result),
    );
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) =>
  (
    await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
  ).result.value;

async function waitFor(expression, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    if (await evaluate(expression)) return;
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

const shot = async (path) =>
  writeFileSync(
    path,
    Buffer.from(
      (await send("Page.captureScreenshot", { format: "png" })).data,
      "base64",
    ),
  );

await send("Runtime.enable");

let failure = null;

try {
  await waitFor(`document.readyState === "complete"`, 90000);

  if (await evaluate(`location.pathname === "/welcome"`)) {
    await shot("android-smoke/welcome.png");

    await evaluate(`
      history.pushState({}, "", "/overview");
      dispatchEvent(new PopStateEvent("popstate"));
      true
    `);
  }

  await waitFor(`!!document.querySelector(".header")`, 90000);
  await waitFor(`!!document.querySelector(".connection.connected")`, 90000);

  await sleep(3000);
  await shot("android-smoke/overview.png");

  // Stay on the overview while the WebGL map starts:
  // a crash here is the map, not the dispatcher.
  await sleep(20000);
  await shot("android-smoke/overview-map.png");

  await evaluate(`
    history.pushState({}, "", "/dispatch");
    dispatchEvent(new PopStateEvent("popstate"));
    true
  `);

  await waitFor(
    `document.querySelectorAll(".dispatch-queue-item").length > 0`,
    60000,
  );

  await sleep(2000);
  await shot("android-smoke/dispatch.png");
} catch (error) {
  failure = error.message;
  await shot("android-smoke/failure.png").catch(() => undefined);
}

const report = alive
  ? await evaluate(`({
      url: location.href,
      width: innerWidth,
      horizontalScroll: document.documentElement.scrollWidth > innerWidth,
      connection: document.querySelector(".connection")?.className ?? null,
      queue: document.querySelectorAll(".dispatch-queue-item").length,
      decision: document.querySelector(".decision-card h4")?.textContent ?? null,
    })`).catch(() => ({}))
  : {};

Object.assign(report, {
  errors,
  failure,
  webviewAlive: alive,
});

writeFileSync(
  "android-smoke/report.json",
  JSON.stringify(report, null, 2),
);

console.log(JSON.stringify(report, null, 2));

ws.close();

if (failure || errors.length || !report.queue) {
  process.exit(1);
}