/** Bounded local HTTP/WS stress against the same Nginx entry point used by the jury. */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";

const site = new URL(process.env.TRANSIT_SITE_URL || "http://127.0.0.1:8080");
if (!["localhost", "127.0.0.1", "[::1]"].includes(site.hostname))
  throw new Error("This stress test is restricted to a local test deployment");
function integer(name, fallback, min, max) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}`);
  return n;
}
const seconds = integer("BENCH_SECONDS", 180, 10, 1800);
const workers = integer("BENCH_WORKERS", 8, 1, 32);
const clients = integer("BENCH_WS_CLIENTS", 25, 1, 50);
const pauseMs = integer("BENCH_PAUSE_MS", 200, 20, 5000);
const output = process.env.BENCH_OUTPUT || "reports/jury-stress.json";
const paths = ["/api/v1/forecast", "/api/v1/vehicles", "/api/v1/routes",
  "/api/v1/network/summary", "/api/v1/alerts", "/api/v1/analytics/delay-series",
  "/overview", "/dispatch", "/analytics", "/data/official-road-routes.json"];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const wsUrl = new URL("/api/v1/stream", site).href.replace(/^http/, "ws");
const rows = [], errors = [], sockets = [], heartbeats = Array(clients).fill(0);
let oversizedFrameRejected = false;
let closing = false, messages = 0, wsErrors = 0, unexpectedCloses = 0;
const start = performance.now(), startedAt = new Date().toISOString();
const recordError = value => { if (errors.length < 30) errors.push(String(value)); };
async function request(path, options = {}, expected = 200) {
  const begin = performance.now();
  try {
    const r = await fetch(new URL(path, site), { ...options, signal: AbortSignal.timeout(10000) });
    const body = await r.text();
    if (r.status !== expected) throw new Error(`${path}: HTTP ${r.status}, expected ${expected}`);
    if (expected === 200 && (path.startsWith("/api/") || path.endsWith(".json"))) JSON.parse(body);
    else if (expected === 200 && !body.includes('<div id="root"')) throw new Error(`${path}: missing app shell`);
    rows.push({ path, ms: performance.now() - begin, bytes: Buffer.byteLength(body), ok: true });
  } catch (e) {
    rows.push({ path, ms: performance.now() - begin, ok: false });
    recordError(e.message);
  }
}
for (let i = 0; i < clients; i++) {
  const ws = new WebSocket(wsUrl);
  let lastSequence = 0;
  ws.on("message", data => {
    messages++;
    try {
      const event = JSON.parse(data.toString());
      if (event.sequence !== lastSequence + 1) throw new Error(`WS ${i}: sequence gap`);
      lastSequence = event.sequence;
      if (event.type === "system.heartbeat") heartbeats[i]++;
    } catch (e) { wsErrors++; recordError(e.message); }
  });
  ws.on("error", e => { wsErrors++; recordError(e.message); });
  ws.on("close", () => { if (!closing) unexpectedCloses++; });
  sockets.push(ws);
}
// Broken/abandoned clients must not bring down the other clients or the server.
async function churn() {
  while (!interrupted && performance.now() - start < seconds * 1000) {
    const ws = new WebSocket(wsUrl);
    ws.on("error", () => {});
    ws.on("open", () => ws.terminate());
    const timeout = setTimeout(() => ws.terminate(), 2000);
    ws.on("close", () => clearTimeout(timeout));
    await sleep(2000);
  }
}
let interrupted = false;
process.on("SIGINT", () => { interrupted = true; });
const progress = setInterval(() => process.stderr.write(JSON.stringify({
  seconds: Math.round((performance.now() - start) / 1000), requests: rows.length,
  failed: rows.filter(r => !r.ok).length, messages, unexpectedCloses, wsErrors,
}) + "\n"), 30000);
try {
  await Promise.all([...Array.from({ length: workers }, (_, worker) => (async () => {
    let i = worker;
    while (!interrupted && performance.now() - start < seconds * 1000) {
      await request(paths[i++ % paths.length]);
      await sleep(pauseMs);
    }
  })()), churn()]);
  await request("/api/v1/not-a-real-endpoint", {}, 404);
  await request("/api/v1/dispatch/commands", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: "{" }, 401);
  await request("/api/v1/session", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: "{" }, 400);
  await request("/api/v1/session", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "x".repeat(70000) }) }, 413);
  oversizedFrameRejected = await new Promise(resolve => {
    const ws = new WebSocket(wsUrl);
    let opened = false;
    const timer = setTimeout(() => { ws.terminate(); resolve(false); }, 3000);
    ws.on("error", () => {});
    ws.on("open", () => { opened = true; ws.send(Buffer.alloc(65537)); });
    ws.on("close", () => { clearTimeout(timer); resolve(opened); });
  });
  await request("/api/v1/health");
} finally {
  closing = true;
  clearInterval(progress);
  sockets.forEach(ws => ws.terminate());
}
const latencies = rows.filter(r => r.ok).map(r => r.ms).sort((a,b) => a-b);
const percentile = p => Math.round((latencies[Math.ceil((latencies.length-1)*p)] ?? 0)*100)/100;
const result = { startedAt, completedAt: new Date().toISOString(),
  scope: "Local jury Nginx entry point, reading WS clients, HTTP load and abandoned connections; not a city-wide capacity guarantee",
  config: { site: site.href, seconds, workers, clients, pauseMs },
  summary: { elapsedSec: Math.round((performance.now()-start)/1000), requests: rows.length,
    failedRequests: rows.filter(r => !r.ok).length, p50Ms: percentile(.5), p95Ms: percentile(.95),
    p99Ms: percentile(.99), maxMs: percentile(1), messages, wsErrors, unexpectedCloses,
    minHeartbeatsPerClient: Math.min(...heartbeats), oversizedFrameRejected, interrupted }, errors };
result.passed = !interrupted && result.summary.failedRequests === 0 && wsErrors === 0 &&
  unexpectedCloses === 0 && oversizedFrameRejected && Math.min(...heartbeats) >= seconds * .6;
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
