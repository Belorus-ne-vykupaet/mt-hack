import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const source = "ml/data/official/test";
const target = "docker/local-data/test";
for (const name of ["schedule.csv", "traffic.csv"]) {
  if (!existsSync(`${source}/${name}`)) {
    throw new Error(`Не найдены официальные данные: ${source}/${name}`);
  }
}
if (!existsSync("ml/artifacts/sasha/ensemble.joblib")) {
  throw new Error("Не найдена обученная модель Sasha");
}
mkdirSync(target, { recursive: true });
for (const name of ["schedule.csv", "traffic.csv"])
  copyFileSync(`${source}/${name}`, `${target}/${name}`);
rmSync("docker/local-data/live", { recursive: true, force: true });
mkdirSync("docker/local-data/live", { recursive: true });
writeFileSync("docker/local-data/live/.keep", "");
if (process.env.TELEMETRY_MODE === "ndtp") {
  for (const name of ["schedule_plan.csv", "traffic.csv", "unit-map.json"]) {
    if (!existsSync(`ml/data/live/${name}`))
      throw new Error(`Для NDTP не найден ml/data/live/${name}`);
    copyFileSync(`ml/data/live/${name}`, `docker/local-data/live/${name}`);
  }
}

const apiToken = process.env.API_TOKEN || randomBytes(32).toString("hex");
console.log(`Локальный ключ для команд диспетчера: ${apiToken}`);
const child = spawn(
  "docker",
  ["compose", "-f", "compose.official.yaml", "up", "--build", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      API_TOKEN: apiToken,
    },
  },
);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code || 0;
});
