import { expect, test } from "@playwright/test";

const makeReport = (date: string) => ({
  date, archive: true, firstAsOf: `${date}T07:30:00Z`, lastAsOf: `${date}T08:15:00Z`,
  samples: 30, metrics: { vehiclesObserved: 30, vehiclesWithForecast: 13,
    routesObserved: 6, peakDelayedVehicles: 3, meanPredictedDelaySec: 87, peakPredictedDelaySec: 350 },
  source: "rules", model: null, generatedAt: `${date}T08:15:00Z`, basedOnSamples: 30,
  needsRefresh: false, summary: "Отчёт построен по 30 наблюдённым срезам.",
  highlights: ["Проверить 3 автобуса с риском."],
  coverageNote: "Отчёт построен по сохранённым срезам потока. Он не описывает часы, для которых данных не было, и не является итогом полного дня.",
});

test("daily report and history show real coverage, save Ultra result and fit mobile", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let items = [makeReport("2026-01-06"), makeReport("2026-01-05")];
  await page.route("**/api/v1/dispatch/reports", (route) => route.fulfill({ json: {
    items, modelConfigured: true, model: "GigaChat-3-Ultra",
  } }));
  await page.route("**/api/v1/dispatch/reports/2026-01-06/generate", (route) => {
    items = [{ ...items[0], source: "gigachat", model: "GigaChat-3-Ultra",
      summary: "GigaChat: по сохранённым срезам есть риск задержки, охват дня неполный." }, items[1]];
    return route.fulfill({ json: items[0] });
  });
  await page.goto("/reports?source=official&visual-test=1");
  await expect(page.getByRole("region", { name: "Ежедневные отчёты" })).toBeVisible();
  await expect(page.locator(".daily-report")).toContainText("6 января 2026");
  await expect(page.locator(".daily-report")).toContainText("не является итогом полного дня");
  await page.getByRole("tab", { name: /Прошлые дни/ }).click();
  await expect(page.getByRole("complementary", { name: "Даты отчётов" }).getByRole("button")).toHaveCount(2);
  await page.getByRole("complementary", { name: "Даты отчётов" }).getByRole("button", { name: /5 января/ }).click();
  await expect(page.locator(".daily-report")).toHaveAttribute("data-report-date", "2026-01-05");
  await page.getByRole("tab", { name: /Последний день данных/ }).click();
  await page.getByRole("button", { name: "Сформировать с GigaChat" }).click();
  await expect(page.locator(".daily-report")).toContainText("GigaChat: по сохранённым срезам");
  await expect(page.locator(".report-source")).toHaveText("GigaChat-3-Ultra");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});
