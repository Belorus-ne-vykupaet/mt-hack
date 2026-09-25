const env = import.meta.env || {};
const location = globalThis.location || {
  protocol: "http:",
  host: "localhost:5173",
  search: "",
};
if (new URLSearchParams(location.search).get("source") === "official")
  globalThis.sessionStorage?.setItem("transit-data-source", "api");
const storedSource = globalThis.sessionStorage?.getItem("transit-data-source");
const dataSource = storedSource || env.VITE_DATA_SOURCE || "mock";
const apiUrl = env.VITE_API_URL || "/api/v1";
if (!["mock", "api"].includes(dataSource))
  throw new Error("VITE_DATA_SOURCE must be mock or api");
export const config = {
  dataSource: dataSource as "mock" | "api",
  officialMode: dataSource === "api" && env.VITE_OFFICIAL_MODE === "true",
  apiUrl,
  dispatchApi: dataSource === "api" && env.VITE_DISPATCH_API !== "false",
  integrationUrl:
    env.VITE_INTEGRATION_URL ||
    (dataSource === "api" ? apiUrl : "/integration/v1"),
  wsUrl:
    env.VITE_WS_URL ||
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/v1/stream`,
  mapStyleUrl:
    env.VITE_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/positron",
  darkMapStyleUrl:
    env.VITE_MAP_DARK_STYLE_URL || "https://tiles.openfreemap.org/styles/dark",
  csvMode: dataSource === "mock" && env.VITE_MOCK_SCENARIO === "csv",
  mockScenario: env.VITE_MOCK_SCENARIO || "route-primary-delay",
  debug:
    env.VITE_DEBUG === "true" ||
    new URLSearchParams(location.search).has("debug"),
  visualTest:
    env.VITE_VISUAL_TEST_MODE === "true" ||
    new URLSearchParams(location.search).has("visual-test"),
};
