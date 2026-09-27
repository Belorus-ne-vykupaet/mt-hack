import { expect, test } from "@playwright/test";

test("header identifies archive replay and NDTP without confusing either with live city service", async ({ page, request }) => {
  const status = await (await request.get("/api/v1/ml/status")).json();
  let mode = "official-replay";
  await page.route("**/api/v1/ml/status", route => route.fulfill({
    json: { ...status, mode },
  }));

  await page.goto("/overview?source=official");
  await expect(page.getByText("Архив воспроизводится", { exact: true })).toBeVisible();
  await expect(page.getByText("Архивная телеметрия · обновление каждые 5 с", { exact: true })).toBeVisible();

  mode = "official-ndtp";
  await page.reload();
  await expect(page.getByText("Поток NDTP активен", { exact: true })).toBeVisible();
  await expect(page.getByText("План NDTP · обновление каждые 5 с", { exact: true })).toBeVisible();
});
