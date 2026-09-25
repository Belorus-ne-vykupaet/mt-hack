import { execFileSync } from "node:child_process";
import WebSocket from "ws";

const clients = Number(process.env.BENCH_WS_CLIENTS || 15);
const durationSec = Number(process.env.BENCH_WS_SECONDS || 90);
const url = process.env.TRANSIT_WS_URL || "ws://127.0.0.1:8081/api/v1/stream";
if (!Number.isInteger(clients) || clients < 1 || clients > 50 ||
    !Number.isInteger(durationSec) || durationSec < 10 || durationSec > 600)
  throw new Error("BENCH_WS_CLIENTS and BENCH_WS_SECONDS are out of range");

function gatewayPid() {
  if (process.env.BENCH_GATEWAY_PID) return Number(process.env.BENCH_GATEWAY_PID);
  const port = new URL(url).port || (url.startsWith("wss:") ? "443" : "80");
  const output = execFileSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  const pids = output.trim().split(/\s+/).map(Number).filter(Number.isInteger);
  if (pids.length !== 1) throw new Error(`Expected one gateway on port ${port}, found ${pids.length}`);
  return pids[0];
}
function residentMiB(pid) {
  const kilobytes = Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim());
  if (!Number.isFinite(kilobytes) || kilobytes <= 0) throw new Error("Gateway process exited during benchmark");
  return Math.round(kilobytes / 1024 * 10) / 10;
}

const pid = gatewayPid();
const initialMiB = residentMiB(pid);
let messages = 0;
let heartbeats = 0;
let unexpectedCloses = 0;
let closing = false;
const sockets = await Promise.all(Array.from({ length: clients }, () => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.on("message", (data) => {
    messages += 1;
    if (data.includes('"system.heartbeat"')) heartbeats += 1;
  });
  ws.on("close", () => { if (!closing) unexpectedCloses += 1; });
  ws.once("open", () => resolve(ws));
  ws.once("error", reject);
})));
const samples = [{ second: 0, rssMiB: residentMiB(pid) }];
try {
  for (let second = 5; second <= durationSec; second += 5) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    samples.push({ second, rssMiB: residentMiB(pid) });
  }
} finally {
  closing = true;
  sockets.forEach((ws) => ws.close());
}
const result = {
  scope: "Gateway RSS under consuming WebSocket clients on local official replay; no browser rendering or production transport",
  measuredAt: new Date().toISOString(),
  gatewayPid: pid,
  clients,
  durationSec,
  messages,
  heartbeats,
  unexpectedCloses,
  initialMiB,
  finalMiB: samples.at(-1).rssMiB,
  peakMiB: Math.max(...samples.map((item) => item.rssMiB)),
  samples,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
