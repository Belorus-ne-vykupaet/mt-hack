import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const python = process.env.TRANSIT_PYTHON || "ml/.venv/bin/python";
if (
  !existsSync(python) ||
  !existsSync("ml/data/official/test/traffic.csv") ||
  !existsSync("ml/artifacts/delay.cbm") ||
  !existsSync("ml/artifacts/sasha/ensemble.joblib")
) {
  console.error(
    "Сначала подготовьте Python, официальные CSV и модель по ml/README.md.",
  );
  process.exit(1);
}
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill("SIGTERM"));
  process.exitCode = code;
}
function run(command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on("error", () => stop(1));
  child.on("exit", (code) => stop(code || 0));
  return child;
}
async function ready(url) {
  for (let i = 0; i < 120 && !stopping; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Сервис не запустился: ${url}`);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
try {
  run(
    python,
    [
      "-m",
      "uvicorn",
      "transit_ml.inference:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8092",
    ],
    { PYTHONPATH: "ml:src" },
  );
  await ready("http://127.0.0.1:8092/health");
  run(
    python,
    [
      "-m",
      "uvicorn",
      "transit_ml.backend:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8093",
    ],
    { PYTHONPATH: "ml:src" },
  );
  await ready("http://127.0.0.1:8093/status");
  run(
    process.execPath,
    [
      "--import",
      "tsx",
      "--env-file-if-exists=server/weather-demo.env",
      "--env-file-if-exists=server/.env",
      "server/index.ts",
    ],
    {
      OFFICIAL_BACKEND_URL: "http://127.0.0.1:8093",
      API_JOURNAL: "server/data/official-commands.json",
      NODE_EXTRA_CA_CERTS: resolve("server/certs/russian-trusted-root-ca.pem"),
    },
  );
  await ready("http://127.0.0.1:8081/api/v1/health");
  run(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "4173",
      "--strictPort",
    ],
    { VITE_DATA_SOURCE: "api", VITE_OFFICIAL_MODE: "true" },
  );
  console.log(
    "Transit Hub: http://127.0.0.1:4173/overview · ML docs: http://127.0.0.1:8092/docs · Backend docs: http://127.0.0.1:8093/docs",
  );
} catch (error) {
  console.error(error.message);
  stop(1);
}
