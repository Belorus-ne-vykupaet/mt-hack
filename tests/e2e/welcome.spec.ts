import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("welcome city: chapters, forecast, node details, keyboard rotation and navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/welcome");
  await expect(page.locator(".welcome-scene-label")).toContainText(
    "ДВИЖЕНИЕ В ДЕТАЛЯХ",
  );
  await page.getByRole("button", { name: "Остановить 3D-анимацию" }).click();
  await expect(
    page.getByRole("button", { name: "Продолжить 3D-анимацию" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "02 Предвидеть" }).click();
  await expect(page.locator("h1")).toHaveText("Замечатьраньше.Действовать.");
  await expect(page.locator("#welcome-horizon")).toHaveValue("10");
  await page.locator("#welcome-horizon").fill("15");
  await expect(page.locator(".welcome-timeline output")).toHaveText("+15 мин");
  const marker = page.getByRole("button", {
    name: "Исследовать узел Садовое кольцо",
  });
  await marker.click();
  await expect(page.getByRole("dialog")).toContainText("+10 мин");
  await expect(
    page.getByRole("button", { name: "Закрыть карточку узла" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(marker).toBeFocused();
  const initial = await marker.getAttribute("style");
  await page.locator(".intro-scene").focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => marker.getAttribute("style")).not.toEqual(initial);
  await page.getByRole("button", { name: "Сбросить ракурс" }).click();
  await page.getByRole("button", { name: "03 Управлять" }).click();
  await marker.click();
  await page.getByRole("link", { name: "К сценариям управления" }).click();
  await expect(page).toHaveURL(/\/dispatch$/);
  expect(errors).toEqual([]);
});

for (const width of [1440, 390, 320]) {
  test(`welcome is accessible and fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/welcome");
    await expect(page.locator(".intro-scene canvas")).toBeVisible();
    for (const label of ["01 Наблюдать", "02 Предвидеть", "03 Управлять"]) {
      await page.getByRole("button", { name: label }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.getByRole("button", { name: "01 Наблюдать" }).click();
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page
      .getByRole("link", { name: "Открыть диспетчерскую", exact: true })
      .click();
    await expect(page).toHaveURL(/\/overview$/);
  });
}

test("welcome works with unavailable WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      type: string,
      ...args: unknown[]
    ) {
      if (type.includes("webgl")) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto("/welcome");
  await expect(page.locator(".welcome-fallback")).toBeVisible();
  await page.getByRole("button", { name: "02 Предвидеть" }).click();
  await expect(page.locator("#welcome-horizon")).toHaveValue("10");
  await expect(
    page.getByRole("link", { name: "Открыть диспетчерскую", exact: true }),
  ).toBeVisible();
});
