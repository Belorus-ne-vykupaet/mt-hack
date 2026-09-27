import { spawn } from "node:child_process";
import { resolve } from "node:path";

// Set the certificate before Node starts; POSIX VAR=value syntax fails on Windows.
const child = spawn(process.execPath, [
  "--import", "tsx",
  "--env-file-if-exists=server/weather-demo.env",
  "--env-file-if-exists=server/.env",
  "server/index.ts",
], {
  stdio: "inherit",
  env: { ...process.env, NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS ||
    resolve("server/certs/russian-trusted-root-ca.pem") },
});
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
