import react from "@vitejs/plugin-react";
import { defineConfig, type ViteDevServer } from "vite";
// Serve documentation directories like Nginx instead of the dashboard's SPA fallback.
function documentationIndexes(server: Pick<ViteDevServer, "middlewares">) {
  server.middlewares.use((req, _res, next) => {
    req.url = req.url?.replace(/^\/(docs(?:\/python|\/early-warning)?)\/?(\?.*)?$/, "/$1/index.html$2");
    next();
  });
}
const target = process.env.API_PROXY_TARGET || "http://127.0.0.1:8081";
const proxy = {
  "/api/v1": { target, ws: true, changeOrigin: false },
  "/integration/v1": {
    target,
    changeOrigin: false,
    rewrite: (path: string) => path.replace("/integration/v1", "/api/v1"),
  },
};
export default defineConfig({
  plugins: [react(), {
    name: "documentation-indexes",
    configureServer: documentationIndexes,
    configurePreviewServer: documentationIndexes,
  }],
  server: { proxy },
  preview: { proxy },
});
