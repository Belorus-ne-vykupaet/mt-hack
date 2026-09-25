import { OfficialSource } from "./official";
import { createApi } from "./app";
const host = process.env.API_HOST || "127.0.0.1";
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !process.env.API_TOKEN)
  throw new Error("API_TOKEN is required for a non-loopback listener");
if (
  process.env.API_TOKEN &&
  !/^[A-Za-z0-9_-]{24,200}$/.test(process.env.API_TOKEN)
)
  throw new Error("API_TOKEN must be 24–200 URL-safe characters");
const officialUrl = process.env.OFFICIAL_BACKEND_URL;
const official = officialUrl
  ? new OfficialSource(
      officialUrl,
      (await (await fetch(`${officialUrl}/catalog`)).json()).routes,
    )
  : undefined;
const { server, close } = createApi({
  official,
  journal: process.env.API_JOURNAL || "server/data/commands.json",
  token: process.env.API_TOKEN,
  publicRead: process.env.API_PUBLIC_READ === "true" && !!official,
  origins: process.env.API_ORIGINS?.split(","),
  weather: process.env.WEATHER_ENABLED !== "false",
  yandexWeatherKey: process.env.YANDEX_WEATHER_KEY,
  trafficKey: process.env.YANDEX_ROUTER_KEY,
  modelUrl: process.env.ML_SERVICE_URL,
  modelKey: process.env.ML_SERVICE_TOKEN,
  frozen: process.env.API_FROZEN === "true",
});
server.listen(Number(process.env.API_PORT || 8081), host, () =>
  console.log(
    `Transit API sandbox: http://${host}:${process.env.API_PORT || 8081}/api/v1/health`,
  ),
);
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
