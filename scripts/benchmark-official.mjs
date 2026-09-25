import { performance } from "node:perf_hooks";

const base = process.env.TRANSIT_API_URL || "http://127.0.0.1:8081";
const site = process.env.TRANSIT_SITE_URL || "http://127.0.0.1:4173";
const uiPaths = [
  "/api/v1/forecast",
  "/api/v1/routes",
  "/api/v1/network/summary",
  "/api/v1/vehicles",
  "/api/v1/alerts",
  "/api/v1/analytics/delay-series",
];
const batchSize = Number(process.env.BENCH_BATCH_SIZE || 8);
const batches = Number(process.env.BENCH_BATCHES || 4);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50 ||
    !Number.isInteger(batches) || batches < 1 || batches > 100)
  throw new Error("BENCH_BATCH_SIZE and BENCH_BATCHES must be bounded positive integers");

async function request(path, origin = base) {
  const start = performance.now();
  const response = await fetch(new URL(path, origin), {
    signal: AbortSignal.timeout(10000),
    headers: { "Cache-Control": "no-cache" },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  JSON.parse(body);
  return {
    path,
    latencyMs: Math.round((performance.now() - start) * 100) / 100,
    bytes: Buffer.byteLength(body),
  };
}
function quantile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil((ordered.length - 1) * fraction)];
}
function summarize(rows) {
  const latencies = rows.map((row) => row.latencyMs);
  return {
    count: rows.length,
    medianMs: quantile(latencies, 0.5),
    p95Ms: quantile(latencies, 0.95),
    maxMs: Math.max(...latencies),
    responseBytes: Math.max(...rows.map((row) => row.bytes)),
  };
}

for (const path of uiPaths) await request(path);
const sequential = {};
for (const path of uiPaths) {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(await request(path));
  sequential[path] = summarize(rows);
}
const started = performance.now();
const concurrentRows = [];
for (let batch = 0; batch < batches; batch++) {
  concurrentRows.push(...await Promise.all(Array.from(
    { length: batchSize },
    (_, i) => request(uiPaths[(batch * batchSize + i) % uiPaths.length]),
  )));
}
const elapsedMs = performance.now() - started;
const diagnosticGeometry = [];
for (let i = 0; i < 3; i++)
  diagnosticGeometry.push(await request("/api/v1/routes/geometry"));
const staticMap = await request("/data/official-road-routes.json", site);
const status = await (await fetch(new URL("/api/v1/ml/status", base))).json();
const result = {
  scope: "Local UI REST workload, warm processes, official CSV replay; not a production load test",
  measuredAt: new Date().toISOString(),
  base,
  site,
  platform: process.platform,
  node: process.version,
  ui: {
    sequential,
    concurrent: {
      batchSize,
      batches,
      ...summarize(concurrentRows),
      elapsedMs: Math.round(elapsedMs * 100) / 100,
      completedRequestsPerSec: Math.round(concurrentRows.length / elapsedMs * 100000) / 100,
    },
  },
  oneTimeStaticRoadMap: staticMap,
  diagnosticGeometry: summarize(diagnosticGeometry),
  backend: {
    status: status.status,
    pipelineMs: status.pipelineMs,
    inferenceMs: status.inferenceMs,
    locatedVehicles: status.locatedVehicles,
    predictedVehicles: status.predictedVehicles,
  },
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
