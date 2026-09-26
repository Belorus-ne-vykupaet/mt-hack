import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";

function keyFrom(file, name) {
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trimStart().startsWith(`${name}=`));
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
const liveTarget = "docker/local-data/live";
const ndtpMode = process.env.TELEMETRY_MODE === "ndtp";
const liveSource = process.env.LIVE_PLAN_DIR || "ml/data/live";
const canonical = (path) => existsSync(path) ? realpathSync(path) : resolve(path);
const relativeLiveSource = relative(canonical(liveTarget), canonical(liveSource));
const sourceInsideTarget = ndtpMode && relativeLiveSource !== ""
  && relativeLiveSource !== ".." && !relativeLiveSource.startsWith(`..${sep}`);
if (sourceInsideTarget) {
  throw new Error("LIVE_PLAN_DIR не должен находиться внутри docker/local-data/live");
}
const sameLiveDirectory = ndtpMode && canonical(liveSource) === canonical(liveTarget);
if (ndtpMode) {
  for (const name of ["schedule_plan.csv", "unit-map.json"]) {
    if (!existsSync(`${liveSource}/${name}`))
      throw new Error(`Для NDTP не найден ${liveSource}/${name}`);
  }
}
if (!sameLiveDirectory) {
  rmSync(liveTarget, { recursive: true, force: true });
  mkdirSync(liveTarget, { recursive: true });
  writeFileSync(`${liveTarget}/.keep`, "");
}
if (ndtpMode) {
  for (const name of ["schedule_plan.csv", "unit-map.json"]) {
    if (!sameLiveDirectory) copyFileSync(`${liveSource}/${name}`, `${liveTarget}/${name}`);
  }
  if (!sameLiveDirectory && existsSync(`${liveSource}/traffic.csv`))
    copyFileSync(`${liveSource}/traffic.csv`, `${liveTarget}/traffic.csv`);
}

const apiToken = process.env.API_TOKEN || randomBytes(32).toString("hex");
const weatherKey = process.env.YANDEX_WEATHER_KEY
  ?? keyFrom("server/.env", "YANDEX_WEATHER_KEY")
  ?? keyFrom("server/weather-demo.env", "YANDEX_WEATHER_KEY")
  ?? "";
const gigachatKey = process.env.GIGACHAT_AUTH_KEY
  ?? keyFrom("server/.env", "GIGACHAT_AUTH_KEY")
  ?? "";
const gigachatScope = process.env.GIGACHAT_SCOPE
  ?? keyFrom("server/.env", "GIGACHAT_SCOPE")
  ?? "GIGACHAT_API_PERS";
const gigachatModel = process.env.GIGACHAT_MODEL
  ?? keyFrom("server/.env", "GIGACHAT_MODEL")
  ?? "GigaChat-3-Ultra";
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
      GIGACHAT_AUTH_KEY: gigachatKey,
      GIGACHAT_SCOPE: gigachatScope,
      GIGACHAT_MODEL: gigachatModel,
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
