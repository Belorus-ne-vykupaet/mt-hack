import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
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
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});
