/** Sample the official pipeline over time. Run from the repository root. */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import WebSocket from "ws";

const number = (name, fallback, min, max) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  return value;
};
const durationSec = number("BENCH_SOAK_SECONDS", 1800, 10, 7200);
const intervalSec = number("BENCH_SOAK_INTERVAL", 5, 1, 60);
const clients = number("BENCH_WS_CLIENTS", 1, 0, 50);
const api = process.env.TRANSIT_API_URL || "http://127.0.0.1:8081";
const backend = process.env.TRANSIT_BACKEND_URL || "http://127.0.0.1:8093";
const ml = process.env.TRANSIT_ML_URL || "http://127.0.0.1:8092";
const site = process.env.TRANSIT_SITE_URL || "http://127.0.0.1:4173";
const wsUrl = process.env.TRANSIT_WS_URL || new URL("/api/v1/stream", api).href.replace(/^http/, "ws");
const output = process.env.BENCH_SOAK_OUTPUT || "";
const rssMode = process.env.BENCH_RSS_MODE || "local";
const composeProject = process.env.BENCH_COMPOSE_PROJECT || "transit-hub-official";
if (!["local", "docker", "none"].includes(rssMode)) throw new Error("BENCH_RSS_MODE must be local, docker or none");
const startedAt = new Date().toISOString();
const started = performance.now();
const sourcePaths = ["ml/transit_ml/backend.py", "ml/transit_ml/inference.py", "ml/transit_ml/ndtp.py",
  "ml/transit_ml/evaluation.py", "src/mt_hack/features.py", "server/app.ts", "server/stream.ts",
  "scripts/ndtp-fleet-load.py", "scripts/benchmark-soak.mjs"];
const sourceHashes = () => Object.fromEntries(sourcePaths.map(path =>
  [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const provenance = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  platform: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version,
  cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 2 ** 30),
  sourceSha256: sourceHashes(),
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quantile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil((sorted.length - 1) * p)] * 100) / 100;
};
const distribution = (values) => ({
  count: values.length,
  p50: quantile(values, 0.5),
  p95: quantile(values, 0.95),
  p99: quantile(values, 0.99),
  max: values.length ? Math.round(values.reduce((a, b) => Math.max(a, b), -Infinity) * 100) / 100 : null,
});

function rssMiB(port) {
  try {
    const ids = execFileSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", timeout: 2000 })
      .trim().split(/\s+/).filter(Boolean);
    if (ids.length !== 1) return null;
    const kb = Number(execFileSync("ps", ["-o", "rss=", "-p", ids[0]], { encoding: "utf8", timeout: 2000 }).trim());
    return Number.isFinite(kb) && kb > 0 ? Math.round(kb / 1024 * 10) / 10 : null;
  } catch { return null; }
}
function dockerRssMiB(service) {
  try {
    const ids = execFileSync("docker", ["ps", "--filter", `label=com.docker.compose.project=${composeProject}`,
      "--filter", `label=com.docker.compose.service=${service}`, "--format", "{{.ID}}"],
    { encoding: "utf8", timeout: 3000 }).trim().split(/\s+/).filter(Boolean);
    if (ids.length !== 1) return null;
    const scan = 'for f in /proc/[0-9]*/status; do n= r=; while read -r k v rest; do case "$k" in Name:) n="$v";; VmRSS:) r="$v";; esac; done < "$f"; case "$n" in node|python|uvicorn|nginx) [ -n "$r" ] && printf "%s %s\\n" "$n" "$r";; esac; done';
    const lines = execFileSync("docker", ["exec", ids[0], "sh", "-c", scan], { encoding: "utf8", timeout: 3000 })
      .trim().split("\n").filter(Boolean);
    const rss = lines.map((line) => Number(line.split(" ").at(-1))).filter((value) => Number.isFinite(value) && value > 0);
    return rss.length ? Math.round(Math.max(...rss) / 1024 * 10) / 10 : null;
  } catch { return null; }
}
async function getJson(origin, path) {
  const begin = performance.now();
  try {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(4000), headers: { "Cache-Control": "no-cache" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    return { ok: true, ms: Math.round((performance.now() - begin) * 100) / 100, body };
  } catch (error) {
    return { ok: false, ms: Math.round((performance.now() - begin) * 100) / 100, error: String(error.cause?.code || error.message || error) };
  }
}

let wsMessages = 0;
let wsHeartbeats = 0;
let wsUnexpectedCloses = 0;
let wsErrors = 0;
const eventToBrowserMs = [];
const observedVehicles = new Set();
let closing = false;
const sockets = [];
for (let i = 0; i < clients; i++) {
  const socket = new WebSocket(wsUrl);
  const seen = new Map();
  socket.on("message", (data) => {
    wsMessages++;
    if (data.includes('"system.heartbeat"')) wsHeartbeats++;
    const event = JSON.parse(data.toString());
    if (event.type === "vehicle.updated") {
      const v = event.payload;
      const at = Date.parse(v.updated_at);
      if (v.status === "active" && at >= Date.parse(startedAt) && at > (seen.get(v.id) || 0)) {
        seen.set(v.id, at);
        observedVehicles.add(v.id);
        // Same-host UTC clock; includes 1 s NDTP timestamp precision and UI cadence.
        eventToBrowserMs.push(Math.max(0, Date.now() - at));
      }
    }
  });
  socket.on("close", () => { if (!closing) wsUnexpectedCloses++; });
  socket.on("error", () => { wsErrors++; });
  sockets.push(socket);
}

const samples = [];
let lastProgress = -60;
let interrupted = false;
process.on("SIGINT", () => { interrupted = true; });
process.on("SIGTERM", () => { interrupted = true; });
const ports = {
  frontend: Number(new URL(site).port || 80),
  api: Number(new URL(api).port || 80),
  backend: Number(new URL(backend).port || 80),
  ml: Number(new URL(ml).port || 80),
};
try {
  while (!interrupted && performance.now() - started < durationSec * 1000) {
    const [backendStatus, apiStatus, forecast, mlHealth] = await Promise.all([
      getJson(backend, "/status"),
      getJson(api, "/api/v1/ml/status"),
      getJson(api, "/api/v1/forecast"),
      getJson(ml, "/health"),
    ]);
    const b = backendStatus.body || {};
    const a = apiStatus.body || {};
    samples.push({
      at: new Date().toISOString(),
      elapsedSec: Math.round((performance.now() - started) / 1000),
      http: {
        backendStatusMs: backendStatus.ms, backendStatusOk: backendStatus.ok,
        apiStatusMs: apiStatus.ms, apiStatusOk: apiStatus.ok,
        forecastMs: forecast.ms, forecastOk: forecast.ok,
        mlHealthMs: mlHealth.ms, mlHealthOk: mlHealth.ok,
      },
      errors: Object.fromEntries(Object.entries({ backendStatus, apiStatus, forecast, mlHealth })
        .filter(([, value]) => !value.ok).map(([key, value]) => [key, value.error])),
      backend: {
        mode: b.mode ?? null, status: b.status ?? null,
        pipelineMs: b.pipelineMs ?? null, inferenceMs: b.inferenceMs ?? null,
        predictedVehicles: b.predictedVehicles ?? null,
        freshVehicles: b.freshVehicles ?? null,
        staleVehicles: b.staleVehicles ?? null,
        totalVehicles: b.totalVehicles ?? null,
        ndtp: b.ndtp ?? null,
        pipelineLatencyMs: b.pipelineLatencyMs ?? null,
      },
      api: { status: a.status ?? null, stale: a.stale ?? null },
      ws: { messages: wsMessages, heartbeats: wsHeartbeats, unexpectedCloses: wsUnexpectedCloses },
      rssMiB: Object.fromEntries(Object.entries(ports).map(([name, port]) => [name,
        rssMode === "local" ? rssMiB(port) : rssMode === "docker" ? dockerRssMiB(name) : null])),
    });
    if ((performance.now() - started) / 1000 - lastProgress >= 60) {
      lastProgress = (performance.now() - started) / 1000;
      process.stderr.write(`${JSON.stringify({ elapsedSec: Math.round(lastProgress), samples: samples.length,
        failedSamples: samples.filter(s => Object.keys(s.errors).length).length,
        wsUnexpectedCloses, wsErrors, observedVehicles: observedVehicles.size,
        pipelineMs: b.pipelineMs, ndtp: b.ndtp, rssMiB: samples.at(-1).rssMiB })}\n`);
    }
    const next = started + samples.length * intervalSec * 1000;
    const wakeAt = Math.min(next, started + durationSec * 1000);
    if (!interrupted && wakeAt > performance.now())
      await sleep(Math.min(wakeAt - performance.now(), 60000));
  }
} finally {
  closing = true;
  sockets.forEach((socket) => socket.close());
}

const valid = (values) => values.filter((value) => Number.isFinite(value));
const first = samples[0];
const last = samples.at(-1);
const elapsedSec = Math.round((performance.now() - started) / 1000);
const frameDelta = Number.isFinite(first?.backend.ndtp?.frames) && Number.isFinite(last?.backend.ndtp?.frames)
  ? last.backend.ndtp.frames - first.backend.ndtp.frames : null;
const result = {
  scope: "Local official pipeline time-series; HTTP client latency includes network and JSON; backend pipelineMs is last calculation, not per-frame end-to-end latency",
  startedAt, completedAt: new Date().toISOString(), interrupted,
  provenance: { ...provenance, sourceChangedDuringRun: JSON.stringify(provenance.sourceSha256) !== JSON.stringify(sourceHashes()) },
  config: { durationSec, intervalSec, clients, api, backend, ml, site, wsUrl, rssMode, composeProject },
  summary: {
    elapsedSec, samples: samples.length,
    forecastHttpMs: distribution(valid(samples.map((s) => s.http.forecastOk ? s.http.forecastMs : null))),
    backendPipelineMs: distribution(valid(samples.map((s) => s.backend.pipelineMs))),
    mlInferenceMs: distribution(valid(samples.map((s) => s.backend.inferenceMs))),
    failedSamples: samples.filter((s) => Object.keys(s.errors).length).length,
    staleSamples: samples.filter((s) => s.api.stale === true).length,
    ndtpFramesDelta: frameDelta,
    ndtpFramesPerSec: frameDelta === null || elapsedSec === 0 ? null : Math.round(frameDelta / elapsedSec * 100) / 100,
    ndtpErrorsDelta: Number.isFinite(first?.backend.ndtp?.errors) && Number.isFinite(last?.backend.ndtp?.errors)
      ? last.backend.ndtp.errors - first.backend.ndtp.errors : null,
    ndtpCoalescedDelta: Number.isFinite(first?.backend.ndtp?.coalescedPackets) && Number.isFinite(last?.backend.ndtp?.coalescedPackets)
      ? last.backend.ndtp.coalescedPackets - first.backend.ndtp.coalescedPackets : null,
    ndtpUnmappedDelta: Number.isFinite(first?.backend.ndtp?.unmappedPackets) && Number.isFinite(last?.backend.ndtp?.unmappedPackets)
      ? last.backend.ndtp.unmappedPackets - first.backend.ndtp.unmappedPackets : null,
    ndtpIgnoredUnitsAtEnd: last?.backend.ndtp?.ignoredUnits ?? null,
    forecastPendingSamples: samples.filter((s) => s.backend.ndtp?.forecastPending === true).length,
    lastPacketAgeSec: distribution(valid(samples.map((s) => s.backend.ndtp?.lastPacketAgeSec))),
    backendReportedPipelineLatencyMs: last?.backend.pipelineLatencyMs ?? null,
    wsMessages, wsHeartbeats, wsUnexpectedCloses, wsErrors,
    observedVehicles: observedVehicles.size,
    eventToWebSocketMs: distribution(eventToBrowserMs),
    eventToWebSocketDefinition: "First received update for each new vehicle telemetry timestamp on each reading WS client; UTC generator event timestamp to client receipt, includes 1-second timestamp quantization and 5-second broadcast cadence. Excludes warm history and repeated old positions.",
    freshVehicles: distribution(valid(samples.map(s => s.backend.freshVehicles))),
    predictedVehicles: distribution(valid(samples.map(s => s.backend.predictedVehicles))),
    rssMiB: Object.fromEntries(Object.keys(ports).map((name) => [name, {
      first: first?.rssMiB[name] ?? null,
      last: last?.rssMiB[name] ?? null,
      peak: valid(samples.map((s) => s.rssMiB[name])).length ? Math.max(...valid(samples.map((s) => s.rssMiB[name]))) : null,
      windows: Array.from({ length: Math.ceil(elapsedSec / 300) }, (_, i) => {
        const values = valid(samples.filter(s => s.elapsedSec >= i * 300 && s.elapsedSec < (i+1)*300).map(s => s.rssMiB[name]));
        return { fromSec: i*300, toSec: (i+1)*300, count: values.length, median: quantile(values, .5), peak: values.length ? Math.max(...values) : null };
      }),
    }])),
  },
  samples,
};
const json = `${JSON.stringify(result, null, 2)}\n`;
if (output) writeFileSync(output, json);
process.stdout.write(json);
