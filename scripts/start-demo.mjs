import { spawn } from "node:child_process";
import { resolve } from "node:path";
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const args of [
  [
    "--import",
    "tsx",
    "--env-file-if-exists=server/weather-demo.env",
    "--env-file-if-exists=server/.env",
    "server/index.ts",
  ],
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4173",
    "--strictPort",
  ],
]) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: args.at(-1) === "server/index.ts"
      ? { ...process.env, NODE_EXTRA_CA_CERTS: resolve("server/certs/russian-trusted-root-ca.pem") }
      : process.env,
  });
  children.push(child);
  child.on("error", () => stop(1));
  child.on("exit", (code) => stop(code || 0));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
