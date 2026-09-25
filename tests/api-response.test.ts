import { expect, it } from "vitest";
import { readApiJson } from "../src/shared/api/json";
it("rejects a successful SPA fallback as a useful connection error", async () => {
  await expect(
    readApiJson(
      new Response("<!doctype html><html>app</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    ),
  ).rejects.toThrow("Вместо данных API");
  await expect(readApiJson(new Response("<html>app</html>"))).rejects.toThrow(
    "Вместо данных API",
  );
});
it("reports malformed data without exposing parser internals", async () => {
  await expect(readApiJson(new Response("{broken"))).rejects.toThrow(
    "некорректный ответ",
  );
  await expect(readApiJson(Response.json({ items: [] }))).resolves.toEqual({
    items: [],
  });
});
