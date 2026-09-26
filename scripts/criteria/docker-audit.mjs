// Container-level audit for criteria 2–5 on the jury path.
// Run after `node scripts/start-official-docker.mjs -d` with the official archive prepared.
// It stops/starts services, so never point it at a stand someone is using.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import WebSocket from "ws";

if (process.env.CRITERIA_ALLOW_DOCKER_MUTATION !== "1")
  throw new Error("Set CRITERIA_ALLOW_DOCKER_MUTATION=1: the audit stops and restarts containers");

const API = "http://127.0.0.1:8081/api/v1";
const BACKEND = "http://127.0.0.1:8093";
const ML = "http://127.0.0.1:8092";
const SITE = "http://127.0.0.1:8080";
const ORIGIN = SITE;
const EMULATOR = "http://127.0.0.1:18080";
const ARCHIVE = "ml/data/official-dataset.zip";
const OUT = process.env.CRITERIA_REPORT_DIR || "reports/criteria";
const PROJECT_NETWORK = "transit-hub-official_default";
const report = { startedAt: new Date().toISOString(), checks: [], measurements: {} };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (n) => (n == null ? n : Math.round(n * 100) / 100);
function check(id, ok, detail) {
  report.checks.push({ id, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${detail === undefined ? "" : JSON.stringify(detail)}`);
}
function measure(key, value) {
  report.measurements[key] = value;
  console.log(`MEASURE ${key} ${JSON.stringify(value)}`);
}
function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return { n: sorted.length, p50: round(at(50)), p95: round(at(95)), max: round(sorted.at(-1)) };
}
async function request(url, init = {}) {
  const started = performance.now();
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeout ?? 15000) });
    const text = await response.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}
    return { status: response.status, body, type: response.headers.get("content-type") || "", ms: performance.now() - started };
  } catch (error) {
    return { status: 0, error: String(error), ms: performance.now() - started };
  }
}
async function waitFor(probe, timeoutMs, stepMs = 500) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    try {
      const value = await probe();
      if (value) return { ok: true, seconds: round((performance.now() - started) / 1000), value };
    } catch {}
    await sleep(stepMs);
  }
  return { ok: false, seconds: round((performance.now() - started) / 1000) };
}
const compose = (args, env = {}) =>
  execFileSync("docker", ["compose", "-f", "compose.official.yaml", ...args], {
    encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
const status = async () => (await request(`${BACKEND}/status`)).body;
const forecastReady = async () => {
  const s = await status();
  return s?.status === "connected" && s.predictedVehicles > 0 ? s : false;
};
function listen(seconds) {
  return new Promise((resolve) => {
    const events = [];
    const ws = new WebSocket(`ws://127.0.0.1:8081/api/v1/stream`, { origin: ORIGIN });
    ws.on("message", (raw) => {
      try { events.push({ at: Date.now(), ...JSON.parse(raw.toString()) }); } catch {}
    });
    ws.on("error", () => {});
    setTimeout(() => { ws.close(); resolve(events); }, seconds * 1000);
  });
}

// --- K3.2 stack from the jury instructions
{
  const services = compose(["ps", "--format", "json"]).trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
  const state = Object.fromEntries(services.map((s) => [s.Service, `${s.State}/${s.Health || "-"}`]));
  check("k3.stack.four_containers_running", ["frontend", "api", "backend", "ml"].every((n) => state[n]?.startsWith("running")), state);
  check("k3.stack.three_healthy", ["api", "backend", "ml"].every((n) => state[n]?.endsWith("/healthy")), state);
  for (const [id, url] of [["api", `${API}/health`], ["backend", `${BACKEND}/status`], ["ml", `${ML}/health`], ["site", `${SITE}/overview?source=official`]]) {
    const r = await request(url);
    check(`k3.health.${id}`, r.status === 200, { status: r.status, ms: round(r.ms) });
  }
  const docs = await request(`${SITE}/docs/python/`);
  check("k3.pydoc.served_by_site", docs.status === 200 && String(docs.body).includes("transit_ml.backend"), { status: docs.status });
  const apk = await request(`${SITE}/downloads/transit-hub.apk`);
  check("k4.android_apk_served", apk.status === 200 && apk.type.includes("android"), { status: apk.status, type: apk.type });
}

// --- K3.4 Swagger answers a probe request
{
  for (const [name, base, paths] of [["backend", BACKEND, ["/snapshot", "/status", "/warnings/audit"]], ["ml", ML, ["/health", "/predict", "/predict/raw"]]]) {
    const docs = await request(`${base}/docs`);
    const schema = await request(`${base}/openapi.json`);
    check(`k3.swagger.${name}.docs`, docs.status === 200 && String(docs.body).toLowerCase().includes("swagger-ui"), { status: docs.status });
    check(`k3.swagger.${name}.openapi_paths`, schema.status === 200 && paths.every((p) => p in (schema.body.paths || {})), Object.keys(schema.body?.paths || {}));
  }
  const features = Object.fromEntries(["cur_dev_s", "horizon_s", "hour_sin", "hour_cos", "weekday", "speed_last", "speed_mean_120", "speed_mean_600", "speed_std_600", "stopped_ratio_600", "samples_600", "telemetry_age_s", "gps_age_s", "dwell_s", "distance_target_m", "required_speed_kmh", "heading_delta", "target_lat", "target_lon"].map((k) => [k, null]));
  Object.assign(features, { cur_dev_s: 180, horizon_s: 720 });
  const baseline = await request(`${ML}/predict`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ asOf: "2026-01-06T12:00:00Z", items: [{ vehicleId: "probe", features }] }) });
  check("k3.swagger.ml.probe_predict", baseline.status === 200 && Number.isFinite(baseline.body?.predictions?.[0]?.delaySec), baseline.body);
  const t = "2026-01-06 12:00:00", target = "2026-01-06 12:12:00";
  const raw = await request(`${ML}/predict/raw`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ asOf: t, items: [{
    vehicleId: "probe", features,
    point: { sample_id: "probe", tr_id: 1, T: t, target_stop_id: 7, target_time_begin: target, cur_dev_s: 180 },
    telemetry: [{ tr_id: 1, event_time: "2026-01-06 11:59:30", location_valid: true, lon: 37.61, lat: 55.75, speed: 12, heading: 0 }],
    schedule: [{ tt_action_item_id: 7, tr_id: 1, time_begin: target, geom: "POINT (37.62 55.76)" }],
  }] }) });
  check("k3.swagger.ml.probe_predict_raw", raw.status === 200 && Number.isFinite(raw.body?.predictions?.[0]?.delaySec), raw.body);
  const gateway = await request(`${API}/openapi.json`);
  const failing = [];
  for (const [path, methods] of Object.entries(gateway.body?.paths || {})) {
    // External providers are disabled on purpose (no paid keys in the audit).
    if (!methods.get || path.includes("{") || /\/(external|dispatch\/advice)/.test(path)) continue;
    const r = await request(`${API}${path.replace(/^\/api\/v1/, "")}`);
    if (r.status === 404 || r.status >= 500) failing.push(`${path}:${r.status}`);
  }
  check("k3.gateway.openapi_get_paths_answer", gateway.status === 200 && !failing.length, failing);
}

// --- K3.8 end to end: backend forecast = API = WebSocket
{
  const ready = await waitFor(forecastReady, 120000);
  check("k3.e2e.forecast_available", ready.ok, ready.value && { predicted: ready.value.predictedVehicles, located: ready.value.locatedVehicles });
  const snapshot = (await request(`${BACKEND}/snapshot`)).body;
  const vehicles = (await request(`${API}/vehicles`)).body?.items || [];
  const backendIds = new Set(snapshot.vehicles.map((v) => v.id));
  check("k3.e2e.api_vehicles_match_backend", vehicles.length === backendIds.size && vehicles.every((v) => backendIds.has(v.id)), { api: vehicles.length, backend: backendIds.size });
  const horizons = snapshot.vehicles.filter((v) => v.forecast_horizon_sec != null).map((v) => v.forecast_horizon_sec);
  check("k2.e2e.every_forecast_in_window", horizons.length > 0 && horizons.every((h) => h > 600 && h <= 900), percentiles(horizons));
  const alerts = (await request(`${API}/alerts`)).body?.items || [];
  const field = (a, snake, camel) => a[snake] ?? a[camel];
  const complete = alerts.filter((a) =>
    Number.isFinite(field(a, "predicted_delay_sec", "predictedDelaySec")) &&
    field(a, "observed_factor", "observedFactor") &&
    field(a, "expected_arrival_at", "expectedArrivalAt") &&
    field(a, "target_time", "targetTime") &&
    field(a, "vehicle_id", "vehicleId"));
  measure("k2.alerts_at_default_replay_moment", { alerts: alerts.length, complete: complete.length, sample: alerts[0] });
  check("k2.alert_fields.eta_cause_target_vehicle", complete.length === alerts.length, { alerts: alerts.length, complete: complete.length });
  const events = await listen(25);
  const types = {};
  for (const e of events) types[e.type] = (types[e.type] || 0) + 1;
  const stamps = [...new Set(events.filter((e) => e.type === "network.updated").map((e) => e.payload.timestamp))];
  check("k4.stream.data_advances_over_websocket", stamps.length >= 2, { types, networkTimestamps: stamps });
  const streamed = events.filter((e) => e.type === "vehicle.updated").map((e) => e.payload);
  const streamedHorizons = streamed.filter((v) => v.forecast_horizon_sec != null).map((v) => v.forecast_horizon_sec);
  check("k2.stream.websocket_forecasts_in_window", streamedHorizons.every((h) => h > 600 && h <= 900), percentiles(streamedHorizons));
}

// --- K5.1/5.2 latency under the UI's own requests
{
  const times = [];
  for (let i = 0; i < 40; i++) times.push((await request(`${API}/forecast`)).ms);
  const s = await status();
  const ml = (await request(`${ML}/health`)).body;
  measure("k5.api_forecast_ms", percentiles(times));
  measure("k5.backend_pipeline_ms", s.pipelineLatencyMs);
  measure("k5.ml_last_inference_ms", ml.lastInferenceMs);
  check("k5.latency.api_forecast_p95_under_1s", percentiles(times).p95 < 1000, percentiles(times));
  check("k5.latency.pipeline_p95_under_2s", s.pipelineLatencyMs?.p95 < 2000, s.pipelineLatencyMs);
}

// --- K5.4 ML outage: fallback without falling over, then recovery
{
  compose(["stop", "ml"]);
  const down = await waitFor(async () => (await status())?.status === "fallback", 60000);
  const gateway = (await request(`${API}/ml/status`)).body;
  const forecast = await request(`${API}/forecast`);
  check("k5.ml_outage.backend_switches_to_fallback", down.ok, { seconds: down.seconds });
  check("k5.ml_outage.api_keeps_serving", forecast.status === 200 && gateway?.modelVersion === "persistence-fallback", { api: forecast.status, model: gateway?.modelVersion });
  compose(["start", "ml"]);
  const up = await waitFor(forecastReady, 120000);
  check("k5.ml_outage.recovers", up.ok, { seconds: up.seconds });
  measure("k5.ml_outage_seconds", { toFallback: down.seconds, toRecovery: up.seconds });
}

// --- K5.4 backend outage: last state, marked stale, then recovery
{
  compose(["stop", "backend"]);
  const stale = await waitFor(async () => (await request(`${API}/ml/status`)).body?.stale === true, 60000);
  const forecast = await request(`${API}/forecast`);
  const vehicles = (await request(`${API}/vehicles`)).body?.items || [];
  const heartbeat = (await listen(4)).find((e) => e.type === "system.heartbeat");
  check("k5.backend_outage.marked_stale", stale.ok && heartbeat?.payload?.stale === true, { seconds: stale.seconds, heartbeat: heartbeat?.payload });
  check("k5.backend_outage.last_state_served", forecast.status === 200 && vehicles.length > 0, { status: forecast.status, vehicles: vehicles.length });
  compose(["start", "backend"]);
  const fresh = await waitFor(async () => (await request(`${API}/ml/status`)).body?.stale === false && (await forecastReady()), 120000);
  check("k5.backend_outage.recovers", fresh.ok, { seconds: fresh.seconds });
  measure("k5.backend_outage_seconds", { toStale: stale.seconds, toRecovery: fresh.seconds });
}

// --- K5.5 cold start, three times, images already built
{
  const runs = [];
  for (let i = 0; i < 3; i++) {
    compose(["down"]);
    const started = performance.now();
    compose(["up", "-d", "--no-build"]);
    const ready = await waitFor(async () => (await request(`${SITE}/`)).status === 200 && (await forecastReady()), 240000);
    runs.push(ready.ok ? round((performance.now() - started) / 1000) : null);
  }
  measure("k5.cold_start_to_first_forecast_seconds", runs);
  check("k5.cold_start.predictable", runs.every((r) => r !== null) && Math.max(...runs) - Math.min(...runs) < 30, runs);
}

// --- K2.6 / K3.5 / K5.4 the organizers' NDTP emulator
async function switchToLivePlan(generate) {
  execSync(generate, { stdio: "inherit" });
  compose(["up", "-d", "--no-deps", "--force-recreate", "backend"], { TELEMETRY_MODE: "ndtp" });
  const healthy = await waitFor(async () => (await status())?.mode === "official-ndtp", 120000);
  if (!healthy.ok) throw new Error("backend did not restart in NDTP mode");
}
async function configureEmulator(config) {
  const body = typeof config === "string" ? readFileSync(config, "utf8") : JSON.stringify(config);
  const r = await request(`${EMULATOR}/api/config`, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (r.status >= 300) throw new Error(`emulator config failed: ${r.status} ${JSON.stringify(r.body)}`);
}
if (existsSync(ARCHIVE)) {
  execSync(`unzip -p ${ARCHIVE} ndtp-telemetry-emulator.tar | docker load`, { stdio: "inherit" });
  execSync(`docker rm -f transit-ndtp-emulator >/dev/null 2>&1 || true`);
  execSync(`docker run -d --rm --network ${PROJECT_NETWORK} -p 127.0.0.1:18080:18080 --name transit-ndtp-emulator ndtp-telemetry-emulator:1.0`, { stdio: "inherit" });
  await waitFor(async () => (await request(`${EMULATOR}/`)).status > 0, 60000);

  // Smoke plan of the jury instructions: one mapped device, one unknown.
  await switchToLivePlan("python3 scripts/prepare-ndtp-smoke.py --output docker/local-data/live --target-host backend --target-port 9201");
  await configureEmulator("docker/local-data/live/emulator-config.json");
  const live = await waitFor(async () => {
    const s = await status();
    return s.ndtp.mappedPackets > 0 && s.predictedVehicles >= 1 && s.warningsIssued >= 1 ? s : false;
  }, 90000);
  const s = live.value || (await status());
  check("k3.ndtp.emulator_frames_parsed_without_errors", s.ndtp.frames > 0 && s.ndtp.errors === 0, s.ndtp);
  check("k3.ndtp.unknown_device_ignored", s.ndtp.unmappedPackets > 0, { unmapped: s.ndtp.unmappedPackets });
  check("k2.ndtp.alert_from_live_frames", live.ok, { predicted: s.predictedVehicles, warnings: s.warningsIssued });
  const audit = (await request(`${BACKEND}/warnings/audit`)).body?.items || [];
  check("k2.ndtp.alert_lead_in_window", audit.length > 0 && audit.every((w) => w.lead_time_sec > 600 && w.lead_time_sec <= 900), audit.map((w) => w.lead_time_sec));
  const alerts = (await request(`${API}/alerts`)).body?.items || [];
  check("k3.ndtp.alert_reaches_gateway", alerts.some((a) => audit.some((w) => w.id === a.id)), alerts.map((a) => a.id));

  // Short pause: the service keeps running and resumes counting frames.
  const before = (await status()).ndtp.frames;
  execSync("docker pause transit-ndtp-emulator");
  await sleep(20000);
  const paused = await status();
  execSync("docker unpause transit-ndtp-emulator");
  const resumed = await waitFor(async () => (await status()).ndtp.frames > paused.ndtp.frames, 60000);
  check("k5.ndtp_pause.service_alive_and_resumes", paused && resumed.ok, { before, paused: paused.ndtp.frames, resumedAfter: resumed.seconds });

  // Long silence (>180 s): last position kept as stale, no forecast, then recovery.
  execSync("docker pause transit-ndtp-emulator");
  await sleep(200000);
  const silent = (await request(`${BACKEND}/snapshot`)).body;
  const bus = silent.vehicles.find((v) => v.id === "vehicle-99116336");
  check("k5.ndtp_silence.last_position_marked_stale", bus?.status === "stale" && bus.forecast_status === "stale_gps" && !silent.alerts.length, bus);
  execSync("docker unpause transit-ndtp-emulator");
  const active = await waitFor(async () => (await request(`${BACKEND}/snapshot`)).body.vehicles.some((v) => v.id === "vehicle-99116336" && v.status === "active"), 60000);
  check("k5.ndtp_silence.recovers_on_new_frames", active.ok, { seconds: active.seconds });

  // Official-scale fleet from the real emulator: 30 mapped devices at 1 Hz for 60 s.
  await configureEmulator({ targetHost: "backend", targetPort: 9201, units: [] });
  await switchToLivePlan("python3 tests/criteria/make_fleet_plan.py docker/local-data/live 30 backend 9201");
  await configureEmulator("docker/local-data/live/emulator-config.json");
  await sleep(10000);
  const start = await status();
  const api = [];
  for (let i = 0; i < 60; i++) {
    api.push((await request(`${API}/forecast`)).ms);
    await sleep(1000);
  }
  const end = await status();
  const rate = (end.ndtp.frames - start.ndtp.frames) / 60;
  measure("k5.ndtp_fleet_30", {
    framesPerSecond: round(rate), errors: end.ndtp.errors, predicted: end.predictedVehicles,
    pipelineMs: end.pipelineLatencyMs, lastPacketAgeSec: end.ndtp.lastPacketAgeSec,
    status: end.status, apiForecastMs: percentiles(api),
  });
  check("k5.ndtp_fleet_30.no_backlog", rate > 25 && end.ndtp.errors === 0 && end.ndtp.lastPacketAgeSec < 3, { rate: round(rate), age: end.ndtp.lastPacketAgeSec });
  check("k5.ndtp_fleet_30.model_not_timing_out", end.status === "connected" && end.predictedVehicles >= 25, { status: end.status, predicted: end.predictedVehicles, lastError: end.lastError });
  execSync("docker rm -f transit-ndtp-emulator >/dev/null 2>&1 || true");
  compose(["up", "-d", "--no-deps", "--force-recreate", "backend"], { TELEMETRY_MODE: "replay" });
} else {
  check("k3.ndtp.emulator_image_available", false, `${ARCHIVE} is missing`);
}

mkdirSync(OUT, { recursive: true });
report.finishedAt = new Date().toISOString();
writeFileSync(`${OUT}/docker-audit.json`, JSON.stringify(report, null, 2));
const failed = report.checks.filter((c) => !c.ok);
console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
