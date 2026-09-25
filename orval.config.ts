import { defineConfig } from "orval";
export default defineConfig({
  transit: {
    input: "./contracts/openapi.json",
    output: {
      target: "./src/shared/api/generated/endpoints.ts",
      schemas: "./src/shared/api/generated/models",
      client: "react-query",
      httpClient: "fetch",
      clean: true,
      override: {
        mutator: { path: "./src/shared/api/http.ts", name: "request" },
      },
    },
  },
});
