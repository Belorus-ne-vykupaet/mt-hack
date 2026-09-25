import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

function weatherKeyFrom(file) {
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((entry) => /^\s*YANDEX_WEATHER_KEY\s*=/.test(entry));
  if (!line) return undefined;
  return line.slice(line.indexOf("=") + 1).trim().replace(/^("|')(.*)\1$/, "$2");
}

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
const weatherKey = process.env.YANDEX_WEATHER_KEY
  ?? weatherKeyFrom("server/.env")
  ?? weatherKeyFrom("server/weather-demo.env")
  ?? "";
console.log(`Локальный ключ для команд диспетчера: ${apiToken}`);
const child = spawn(
  "docker",
  ["compose", "-f", "compose.official.yaml", "up", "--build", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      API_TOKEN: apiToken,
      YANDEX_WEATHER_KEY: weatherKey,
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
