/** Optional controlled Compose startup/recovery probe. Never stops services without opt-in. */
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const mode = process.argv[2];
const service = process.argv[3];
if (!(["cold-start", "fault"].includes(mode)) || (mode === "fault" && !["ml", "backend"].includes(service))) {
  throw new Error("Usage: node scripts/benchmark-container-lifecycle.mjs cold-start | fault ml|backend");
}
if (process.env.BENCH_ALLOW_DOCKER_MUTATION !== "1")
  throw new Error("Set BENCH_ALLOW_DOCKER_MUTATION=1 to allow this script to start/stop Compose services");
if (!process.env.API_TOKEN || process.env.API_TOKEN.length < 24)
  throw new Error("Set API_TOKEN (at least 24 characters) for Compose interpolation; it is never logged");

const compose = (args) => execFileSync("docker", ["compose", "-f", "compose.official.yaml", ...args], {
  cwd: process.cwd(), encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "pipe"],
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const since = (start) => Math.round((performance.now() - start) / 10) / 100;
const api = process.env.TRANSIT_API_URL || "http://127.0.0.1:8081";
const backend = process.env.TRANSIT_BACKEND_URL || "http://127.0.0.1:8093";
async function json(origin, path) {
  try {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}
function containers() {
  return compose(["ps", "--format", "json"]).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
async function observe() {
  const [status, forecast, backendStatus] = await Promise.all([
    json(api, "/api/v1/ml/status"),
    json(api, "/api/v1/forecast"),
    json(backend, "/status"),
  ]);
  return {
    apiStatus: status?.status ?? null,
    apiStale: status?.stale ?? null,
    forecastAvailable: forecast !== null,
    backendStatus: backendStatus?.status ?? null,
    predictedVehicles: backendStatus?.predictedVehicles ?? null,
    containerHealth: Object.fromEntries(containers().map((c) => [c.Service, c.Health || c.State])),
  };
}
async function until(start, predicate, timeoutSec = 90) {
  const rows = [];
  while (since(start) < timeoutSec) {
    const row = { second: since(start), ...await observe() };
    rows.push(row);
    if (predicate(row)) return { reachedAtSec: row.second, rows };
    await sleep(1000);
  }
  return { reachedAtSec: null, rows };
}
const measuredAt = new Date().toISOString();
let result;
if (mode === "cold-start") {
  if (containers().some((c) => c.State === "running"))
    throw new Error("Cold-start probe requires all official Compose services stopped beforehand");
  const start = performance.now();
  compose(["up", "-d", "--no-build"]);
  const composeReturnedAtSec = since(start);
  const ready = await until(start, (r) =>
    ["frontend", "api", "backend", "ml"].every((name) => ["healthy", "running"].includes(r.containerHealth[name])) &&
    r.apiStatus === "connected" && r.apiStale === false && r.forecastAvailable && (r.predictedVehicles ?? 0) > 0,
    180,
  );
  const allContainersReadySec = ready.rows.find((r) =>
    ["frontend", "api", "backend", "ml"].every((name) => ["healthy", "running"].includes(r.containerHealth[name])))?.second ?? null;
  result = { mode, measuredAt, composeReturnedAtSec, allContainersReadySec,
    firstNonFallbackForecastSec: ready.reachedAtSec, samples: ready.rows };
} else {
  const active = containers();
  if (!["api", "backend", "ml"].every((name) => active.some((c) => c.Service === name && c.State === "running")))
    throw new Error("Fault probe requires the official API, Backend and ML containers already running");
  const initial = await observe();
  if (initial.apiStatus !== "connected" || initial.apiStale !== false || !initial.forecastAvailable)
    throw new Error("Fault probe requires a fresh, connected forecast before stopping a service");
  let stopped;
  try {
    const start = performance.now();
    compose(["stop", service]);
    stopped = await until(start, service === "backend"
      ? (r) => r.apiStale === true && r.forecastAvailable
      : (r) => r.backendStatus === "fallback" && r.forecastAvailable,
    90);
  } finally {
    compose(["start", service]);
  }
  const resumed = performance.now();
  const recovered = await until(resumed, (r) =>
    r.apiStatus === "connected" && r.apiStale === false && r.forecastAvailable && (r.predictedVehicles ?? 0) > 0,
    120);
  result = {
    mode, service, measuredAt, initial,
    degradationAtSec: stopped?.reachedAtSec ?? null,
    recoveryAfterStartSec: recovered.reachedAtSec,
    degradedSamples: stopped?.rows ?? [], recoveredSamples: recovered.rows,
  };
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (mode === "cold-start" && result.firstNonFallbackForecastSec === null ||
    mode === "fault" && (result.degradationAtSec === null || result.recoveryAfterStartSec === null))
  process.exitCode = 1;
