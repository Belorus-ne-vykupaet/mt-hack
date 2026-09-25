import catalog from "../../src/data/moscow-buses.json" with { type: "json" };
import { test, expect } from "@playwright/test";

test("theme switch is visible and synchronizes already open dashboard tabs", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => localStorage.setItem("transit-theme", "dark"));
  await page.goto("/overview?visual-test=1");
  await page.getByRole("button", { name: "Включить светлую тему" }).click();
  await expect(page.locator(".theme-toggle")).toContainText("Тёмная тема");
  const second = await context.newPage();
  await second.goto("/overview?visual-test=1");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "light");
  await second.getByRole("button", { name: "Включить тёмную тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".map-shell")).toHaveAttribute(
    "data-map-theme",
    "dark",
  );
  await expect(page.locator(".theme-toggle")).toContainText("Светлая тема");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await second.close();
});

test("forecast moves selected bus in both map modes and Now restores telemetry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/overview?visual-test=1");
  await page.getByLabel("Поиск маршрута, ТС или остановки").fill("742");
  await page
    .locator(".search-results")
    .getByRole("button", { name: /ТС 742/ })
    .click();
  const map = page.locator(".map-shell");
  await expect(map).toHaveAttribute("data-map-ready", "true", {
    timeout: 60000,
  });
  const initial = await map.getAttribute("data-selected-vehicle-position");
  expect(initial).toBeTruthy();
  const slider = page.getByLabel("Горизонт прогноза в минутах");
  await slider.fill("7.5");
  await expect(map).not.toHaveAttribute(
    "data-selected-vehicle-position",
    initial!,
  );
  const halfway = await map.getAttribute("data-selected-vehicle-position");
  await expect(page.locator(".map-position-caption")).toContainText(
    "+7 мин 30 с",
  );
  await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
  await expect(map).toHaveAttribute("data-selected-vehicle-position", halfway!);
  await slider.fill("15");
  await expect(map).not.toHaveAttribute(
    "data-selected-vehicle-position",
    halfway!,
  );
  await page.locator(".live-button").click();
  await expect(map).toHaveAttribute("data-selected-vehicle-position", initial!);
  await expect(page.locator(".map-position-caption")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("dispatcher follows alert → route → vehicle and forecast across pages", async ({
  page,
}) => {
  await page.goto("/overview?visual-test=1");
  await expect(
    page.getByRole("heading", { name: "Обзор транспортной сети" }),
  ).toBeVisible();
  await expect(page.getByText("Поток активен")).toBeVisible();
  await page.locator(".alert-card.critical").first().click();
  await expect(page.locator(".detail-panel")).toContainText("Маршрут м3");
  await page.getByRole("tab", { name: "Транспорт", exact: true }).click();
  await page
    .locator(".detail-panel")
    .getByRole("button", { name: /ТС 742/ })
    .click();
  await expect(page.locator(".detail-panel")).toContainText("ТС 742");
  await page.getByRole("button", { name: "+15 мин", exact: true }).click();
  await expect(page.getByLabel("Горизонт прогноза в минутах")).toHaveValue(
    "15",
  );
  await expect(page.locator(".detail-forecast")).toContainText("+8.4");
  await page.getByRole("link", { name: "Аналитика", exact: true }).click();
  await expect(page.locator(".analytics")).toBeVisible();
  await page.getByRole("link", { name: "Обзор сети", exact: true }).click();
  await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
  await expect(
    page.getByRole("heading", { name: "Обзор транспортной сети" }),
  ).toBeVisible();
  await expect(page.locator(".detail-panel")).toContainText("ТС 742");
  await expect(page.getByLabel("Горизонт прогноза в минутах")).toHaveValue(
    "15",
  );
});

test("search, route/risk filters, empty states and layer controls", async ({
  page,
}) => {
  await page.goto("/overview?visual-test=1");
  await page.getByLabel("Поиск маршрута, ТС или остановки").fill("742");
  await page
    .locator(".search-results")
    .getByRole("button", { name: /ТС 742/ })
    .click();
  await expect(page.locator(".detail-panel")).toContainText("ТС 742");
  await page.getByRole("button", { name: "Закрыть карточку" }).click();
  await page.getByLabel("Фильтр по уровню риска").selectOption("normal");
  await expect(page.getByText("Нет событий", { exact: true })).toBeVisible();
  await page.getByLabel("Фильтр по маршрутам", { exact: true }).click();
  await page.getByLabel("Отслеживать маршрут м3", { exact: true }).check();
  await page.getByLabel("Фильтр по маршрутам", { exact: true }).click();
  await expect(
    page.getByText("Нет маршрутов для выбранных фильтров"),
  ).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(
    page.getByText(`${catalog.routes.length} маршрутов в зоне обзора`),
  ).toBeVisible();
  await page.getByRole("button", { name: "Слои карты", exact: true }).click();
  await page.getByLabel("Транспорт", { exact: true }).uncheck();
  await expect(page.getByLabel("Транспорт", { exact: true })).not.toBeChecked();
  await page
    .getByLabel("Поиск маршрута, ТС или остановки")
    .fill("несуществующая станция");
  await expect(page.locator(".search-results")).toContainText(
    "Ничего не найдено",
  );
  await page.getByLabel("Поиск маршрута, ТС или остановки").press("Escape");
  await expect(page.locator(".search-results")).toHaveCount(0);
});

test("offline preserves operational snapshot and reconnects", async ({
  page,
}) => {
  await page.goto("/overview?debug=1&visual-test=1");
  await expect(page.getByText("Поток активен")).toBeVisible();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page
    .getByRole("button", { name: "Открыть сценарии демонстрации" })
    .click();
  await page.getByLabel("Отключить поток").check();
  await expect(page.getByText("Нет соединения", { exact: true })).toBeVisible();
  await expect(page.locator(".summary-strip")).toContainText(
    String(catalog.routes.reduce((n, r) => n + r.vehicleCount, 0)),
  );
  await page.getByLabel("Отключить поток").uncheck();
  await expect(page.getByText("Поток активен")).toBeVisible();
});

test("theme persists after reload and changes chart, map and settings", async ({
  page,
}) => {
  await page.goto("/analytics?visual-test=1");
  await expect(page.locator(".analytics")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".app")).toHaveCSS(
    "background-color",
    "rgb(242, 241, 235)",
  );
  await page.getByRole("button", { name: "Включить тёмную тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.getByLabel("Тема интерфейса")).toHaveValue("dark");
  await page.getByLabel("Тема интерфейса").selectOption("light");
  await page.getByRole("button", { name: "Закрыть карточку" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "Обзор сети" }).click();
  await expect(
    page.getByRole("button", { name: "Включить тёмную тему" }),
  ).toBeVisible();
});

test("continuous forecast supports fractional minutes without playback controls", async ({
  page,
}) => {
  await page.goto("/overview?visual-test=1");
  await page.locator(".alert-card.critical").first().click();
  await expect(
    page.getByRole("button", { name: "Воспроизвести прогноз" }),
  ).toHaveCount(0);
  const slider = page.getByLabel("Горизонт прогноза в минутах");
  await slider.fill("7.5");
  await expect(page.locator(".timeline-caption")).toContainText("+7 мин 30 с");
  await expect(page.locator(".detail-forecast")).toContainText("+5.3");
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("7.51");
  await page.locator(".live-button").click();
  await expect(slider).toHaveValue("0");
  await expect(page.locator(".detail-forecast")).toContainText("+2.3");
});

test("3D renders pickable delay columns and supports layer visibility", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/flow?visual-test=1");
  await expect(page.locator(".map-shell")).toHaveAttribute(
    "data-map-ready",
    "true",
    { timeout: 90000 },
  );
  await expect(page.locator(".map-shell")).toHaveAttribute(
    "data-columns",
    /^[1-9]\d*$/,
  );
  const canvas = page.locator(".map-canvas canvas");
  expect((await canvas.boundingBox())!.height).toBeGreaterThan(300);
  await page.getByRole("button", { name: "+15 мин", exact: true }).click();
  await page.getByRole("button", { name: "Слои карты", exact: true }).click();
  await page.getByLabel("Столбцы задержек").uncheck();
  await expect(page.locator(".map-shell")).toHaveAttribute("data-columns", "0");
  await page.getByLabel("Столбцы задержек").check();
  await expect(page.locator(".map-shell")).toHaveAttribute(
    "data-columns",
    /^[1-9]\d*$/,
  );
  expect(errors).toEqual([]);
});

for (const theme of ["dark", "light"])
  for (const [path, title] of [
    ["overview", "Обзор транспортной сети"],
    ["analytics", "Аналитика движения"],
    ["flow", "Обзор транспортной сети"],
  ])
    test(`${path} works on mobile in ${theme} theme`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(
        (t) => localStorage.setItem("transit-theme", t),
        theme,
      );
      await page.goto(`/${path}?visual-test=1`);
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      await expect(page.getByText("Поток активен")).toHaveCount(1);
      await expect(page.locator(path === "analytics" ? ".kpi-grid" : ".summary-strip")).toContainText(
        String(catalog.routes.reduce((n, r) => n + r.vehicleCount, 0)),
      );
      // Analytics controls the selected route's forecast inside its detail card.
      if (path === "analytics") await page.locator(".alert-card").first().click();
      await page.getByRole("button", { name: "+15 мин", exact: true }).click();
      await expect(page.getByLabel("Горизонт прогноза в минутах")).toHaveValue(
        "15",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/${path}-${theme}-mobile.png`,
        fullPage: true,
      });
    });

test("root redirects to overview and browser back preserves navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/overview$/);
  await page.getByRole("link", { name: "Аналитика", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Аналитика движения" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Обзор транспортной сети" }),
  ).toBeVisible();
});

test("lazy map styles preserve the full map viewport after navigation", async ({
  page,
}) => {
  await page.goto("/welcome?visual-test=1");
  await page.getByRole("link", { name: "Открыть диспетчерскую" }).click();
  const host = page.locator(".map-canvas.maplibregl-map");
  const canvas = host.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible({ timeout: 60000 });

  // Reproduce the library rule arriving after application styles.
  await page.addStyleTag({
    content: ".maplibregl-map { position: relative; }",
  });
  const expectFullViewport = async () => {
    await expect(host).toHaveCSS("position", "absolute");
    await expect
      .poll(async () => {
        const frame = await page.locator(".map-shell").boundingBox();
        const rendered = await canvas.boundingBox();
        return (
          !!frame &&
          !!rendered &&
          rendered.height >= 400 &&
          Math.abs(rendered.height - (frame.height - 2)) < 3 &&
          Math.abs(rendered.width - (frame.width - 2)) < 3
        );
      })
      .toBe(true);
  };
  await expectFullViewport();
  await page.getByRole("link", { name: "Аналитика", exact: true }).click();
  await page.getByRole("link", { name: "Обзор сети", exact: true }).click();
  await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
  await expectFullViewport();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectFullViewport();
  await page.reload();
  await expectFullViewport();
});

for (const theme of ["dark", "light"])
  test(`studio welcome keeps ${theme} theme and returns to dashboard`, async ({
    page,
  }) => {
    await page.goto("/overview?visual-test=1");
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page.locator(".theme-toggle").click();
    await page.getByRole("link", { name: "О проекте", exact: true }).click();
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.locator(".intro-scene canvas")).toBeVisible();
    await page.getByRole("button", { name: "Остановить 3D-анимацию" }).click();
    await expect(
      page.getByRole("button", { name: "Продолжить 3D-анимацию" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Продолжить 3D-анимацию" }).click();
    await expect(
      page.getByRole("button", { name: "Остановить 3D-анимацию" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("link", { name: "Открыть диспетчерскую" }).click();
    await expect(
      page.getByRole("heading", { name: "Обзор транспортной сети" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  });

test("all overview metrics open searchable lists and selection opens map details", async ({
  page,
}) => {
  await page.goto("/overview?visual-test=1");
  await expect(page.locator(".summary-strip")).toContainText(
    String(catalog.routes.reduce((n, r) => n + r.vehicleCount, 0)),
  );
  await expect(page.locator(".heading-tag")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Посмотреть транспорт на линии", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toContainText(
    String(catalog.routes.reduce((n, r) => n + r.vehicleCount, 0)),
  );
  await expect(dialog.locator("tbody tr")).toHaveCount(25);
  await dialog.getByRole("button", { name: "Следующая страница" }).click();
  await expect(dialog.locator("tbody tr")).toHaveCount(
    Math.min(25, catalog.routes.reduce((n, r) => n + r.vehicleCount, 0) - 25),
  );
  await page.getByLabel("Поиск в полном списке").fill("742");
  await expect(dialog.locator("tbody tr")).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "Открыть ТС 742", exact: true })
    .click();
  await expect(page.locator(".detail-panel")).toContainText("ТС 742");
  await page
    .getByRole("button", { name: "Посмотреть активные маршруты" })
    .click();
  await expect(dialog.locator("tbody tr")).toHaveCount(catalog.routes.length);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Посмотреть транспорт по расписанию" })
    .click();
  await expect(dialog.locator("tbody tr")).toHaveCount(
    Math.min(
      25,
      catalog.routes.slice(3).reduce((n, r) => n + r.vehicleCount, 0),
    ),
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Посмотреть события, требующие внимания" })
    .click();
  await expect(dialog.locator("tbody tr")).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("overview resize adjusts map and persists, reset restores defaults", async ({
  page,
}) => {
  await page.goto("/overview?visual-test=1");
  const left = page.getByRole("separator", { name: "Ширина панели состояния" });
  await expect(left).toBeVisible();
  const before = (await page.locator(".map-shell").boundingBox())!;
  const handle = (await left.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + 100, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(left).toHaveAttribute("aria-valuenow", "278");
  await expect
    .poll(async () =>
      Math.round((await page.locator(".map-shell").boundingBox())!.width),
    )
    .toBe(Math.round(before.width) - 60);
  const right = page.getByRole("separator", { name: "Ширина панели событий" });
  await right.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(right).toHaveAttribute("aria-valuenow", "294");
  const height = page.getByRole("separator", {
    name: "Высота рабочей области",
  });
  await height.focus();
  await page.keyboard.press("ArrowDown");
  await expect(height).toHaveAttribute("aria-valuenow", "680");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("transit-overview-layout") || "{}")
            .height,
      ),
    )
    .toBe(680);
  await page.reload();
  await expect(left).toHaveAttribute("aria-valuenow", "278");
  await expect(right).toHaveAttribute("aria-valuenow", "294");
  await expect(height).toHaveAttribute("aria-valuenow", "680");
  await page.getByRole("button", { name: "Сбросить размеры" }).click();
  await expect(left).toHaveAttribute("aria-valuenow", "218");
  await expect(height).toHaveAttribute("aria-valuenow", "660");
});

test("All routes footer opens list and in-map 3D rotates without navigation", async ({
  page,
}) => {
  await page.goto("/overview?visual-test=1");
  await page.getByRole("button", { name: "Все маршруты", exact: true }).click();
  await expect(page.getByRole("dialog").locator("tbody tr")).toHaveCount(
    catalog.routes.length,
  );
  await page
    .getByRole("button", { name: "Открыть Маршрут с344", exact: true })
    .click();
  await expect(page.locator(".route-impact")).toContainText(
    "0 из 12 участков · 3 из 8 автобусов",
  );
  const map = page.locator(".map-shell");
  await expect(map).toHaveAttribute("data-map-ready", "true", {
    timeout: 60000,
  });
  await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
  await expect(page).toHaveURL(/overview/);
  await expect(map).toHaveAttribute("data-map-mode", "flow");
  await expect(
    page.getByRole("link", { name: "3D-прогноз", exact: true }),
  ).toHaveCount(0);
  await expect(map).toHaveAttribute("data-pitch", "52");
  await expect(
    page.getByRole("button", {
      name: /Повернуть карту|наклон карты|Ориентировать карту/,
    }),
  ).toHaveCount(0);
  await expect(map).toHaveAttribute("data-column-labels", "0");
  await expect(page.locator(".flow-hint")).toHaveCount(0);
  const box = (await page.locator(".map-canvas canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.55);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.65, {
    steps: 10,
  });
  await page.mouse.up({ button: "right" });
  await expect(map).not.toHaveAttribute("data-bearing", "0");
  await expect(map).not.toHaveAttribute("data-pitch", "52");
  // Ctrl + left drag also rotates, with no toolbar or mode change.
  const before = await map.getAttribute("data-bearing");
  await page.keyboard.down("Control");
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5, {
    steps: 12,
  });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await expect(map).not.toHaveAttribute("data-bearing", before!);
  await page.getByRole("button", { name: "Переключить карту в 2D" }).click();
  await expect(map).toHaveAttribute("data-map-mode", "overview");
  await expect(map).toHaveAttribute("data-pitch", "0");
  await expect(page.locator(".detail-panel")).toContainText("Маршрут с344");
});

test("3D responds to two-finger rotation and pitch on touch screens", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5173/overview?visual-test=1");
  const map = page.locator(".map-shell");
  await expect(map).toHaveAttribute("data-map-ready", "true", {
    timeout: 60000,
  });
  await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
  await map.scrollIntoViewIfNeeded();
  await expect(map).toHaveAttribute("data-pitch", "52");
  const box = (await map.boundingBox())!,
    x = box.x + box.width * 0.5,
    y = box.y + box.height * 0.62;
  const cdp = await context.newCDPSession(page);
  const touch = (type: string, points: { x: number; y: number }[]) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((p, id) => ({
        ...p,
        id,
        radiusX: 3,
        radiusY: 3,
        force: 1,
      })),
    });
  await touch("touchStart", [
    { x: x - 45, y },
    { x: x + 45, y },
  ]);
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * 0.7;
    await touch("touchMove", [
      { x: x - 45 * Math.cos(a), y: y - 45 * Math.sin(a) },
      { x: x + 45 * Math.cos(a), y: y + 45 * Math.sin(a) },
    ]);
  }
  await touch("touchEnd", []);
  await expect(map).not.toHaveAttribute("data-bearing", "0");
  const pitch = await map.getAttribute("data-pitch");
  await touch("touchStart", [
    { x: x - 40, y },
    { x: x + 40, y },
  ]);
  for (let i = 1; i <= 12; i++)
    await touch("touchMove", [
      { x: x - 40, y: y + i * 5 },
      { x: x + 40, y: y + i * 5 },
    ]);
  await touch("touchEnd", []);
  await expect(map).not.toHaveAttribute("data-pitch", pitch!);
  await context.close();
});

test("3D bus model loads locally, follows forecast, remains selectable and respects visibility", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("transit-theme", "dark"));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/overview?visual-test=1");
  await page.getByLabel("Поиск маршрута, ТС или остановки").fill("742");
  await page
    .locator(".search-results")
    .getByRole("button", { name: /ТС 742/ })
    .click();
  const map = page.locator(".map-shell");
  await expect(map).toHaveAttribute("data-map-ready", "true", {
    timeout: 60000,
  });
  const asset = page.waitForResponse((r) =>
    r.url().endsWith("/models/bus.glb"),
  );
  await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
  expect((await asset).status()).toBe(200);
  await expect(map).toHaveAttribute("data-bus-models", "120");
  const initial = await map.getAttribute("data-selected-vehicle-position");
  const heading = await map.getAttribute("data-selected-vehicle-heading");
  await page.getByLabel("Горизонт прогноза в минутах").fill("7.5");
  await expect(map).not.toHaveAttribute(
    "data-selected-vehicle-position",
    initial!,
  );
  await expect(map).not.toHaveAttribute(
    "data-selected-vehicle-heading",
    heading!,
  );
  await page.locator(".live-button").click();
  await page.getByRole("button", { name: "Слои карты", exact: true }).click();
  await page.getByLabel("Столбцы задержек").uncheck();
  await page.getByLabel("Транспорт", { exact: true }).uncheck();
  await expect(map).toHaveAttribute("data-bus-models", "0");
  await page.getByLabel("Транспорт", { exact: true }).check();
  await expect(map).toHaveAttribute("data-bus-models", "120");
  await page.getByRole("button", { name: "Слои карты", exact: true }).click();
  await page.getByRole("button", { name: "Закрыть карточку" }).click();
  const box = (await page.locator(".map-canvas canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 5);
  await expect(page.locator(".detail-panel")).toContainText("ТС 742");
  await page.getByRole("button", { name: "Включить светлую тему" }).click();
  await expect(map).toHaveAttribute("data-map-theme", "light");
  await expect(map).toHaveAttribute("data-bus-models", "120");
  await page.getByRole("button", { name: "Переключить карту в 2D" }).click();
  await expect(map).toHaveAttribute("data-bus-models", "0");
  expect(errors).toEqual([]);
});

test("failed 3D model preserves transport as icons with a clear status", async ({
  page,
}) => {
  // MSW owns requests in this demo, so intercept fetch before the service worker.
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch;
    window.fetch = (input, init) =>
      String(input instanceof Request ? input.url : input).includes(
        "/models/bus.glb",
      )
        ? Promise.reject(new TypeError("Model unavailable for test"))
        : fetchOriginal(input, init);
  });
  await page.goto("/overview?visual-test=1");
  await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
  await expect(page.locator(".map-model-notice")).toContainText(
    "транспорт показан значками",
    { timeout: 60000 },
  );
  await expect(page.locator(".map-shell")).toHaveAttribute(
    "data-bus-model-status",
    "fallback",
  );
  await page.getByLabel("Поиск маршрута, ТС или остановки").fill("742");
  await page
    .locator(".search-results")
    .getByRole("button", { name: /ТС 742/ })
    .click();
  await expect(page.locator(".detail-panel")).toContainText("ТС 742");
});

test("dispatcher applies a fleet and dwell scenario, persists it, and undo restores the network", async ({
  page,
}) => {
  await page.goto("/dispatch?visual-test=1");
  await expect(
    page.getByRole("heading", { name: "Диспетчерская" }),
  ).toBeVisible();
  await page.getByLabel("Плановое количество автобусов").fill("10");
  await page.getByLabel("Плановая стоянка").fill("60");
  await expect(page.locator(".dispatch-preview")).toContainText("12 мин 3 с");
  await page
    .getByRole("button", { name: "Применить в демо", exact: true })
    .click();
  await expect(page.locator(".dispatch-notice")).toContainText("применён");
  await expect(page.locator(".dispatch-context")).toContainText("10 на линии");
  await expect(page.locator(".dispatch-journal")).toContainText(
    "Применён в демо",
  );
  await expect(page.getByRole("button", { name: "Применить в демо", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.locator(".dispatch-context")).toContainText("10 на линии");
  await page.getByRole("link", { name: "Обзор сети", exact: true }).click();
  await expect(page.locator(".summary-strip")).toContainText("122");
  await expect(page.locator(".dispatch-active-banner")).toContainText("1");
  await page.getByRole("link", { name: "Диспетчер", exact: true }).click();
  await page
    .locator(".dispatch-journal")
    .getByRole("button", { name: "Отменить", exact: true })
    .click();
  await expect(page.locator(".dispatch-context")).toContainText("8 на линии");
  await expect(page.locator(".dispatch-journal")).toContainText("Отменён");
});

test("dispatcher validates reserve, supports plan-only saving and fits mobile themes", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("transit-theme", "dark"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dispatch?visual-test=1");
  await page.getByLabel("Плановое количество автобусов").fill("13");
  await expect(
    page.getByRole("button", { name: "Применить в демо", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("Не хватает");
  await page.getByRole("button", { name: "Сохранить только план" }).click();
  await expect(page.locator(".dispatch-context")).toContainText("8 на линии");
  await expect(page.locator(".dispatch-journal")).toContainText("План");
  await page.getByRole("button", { name: "Включить светлую тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Плановое количество автобусов").fill("0");
  await expect(
    page.getByRole("button", { name: "Применить в демо", exact: true }),
  ).toBeDisabled();
});

test("dispatch suggestions cover all routes, prefill without applying, and keep manual edits", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("transit-theme", "dark"));
  await page.goto("/dispatch?visual-test=1");
  const rows = page.locator(".recommend-table tbody tr");
  await expect(rows).toHaveCount(15);
  await expect(page.locator(".recommend-method")).toHaveText(
    "Подсказки по правилам",
  );
  const button = page.locator(".recommend-table button:enabled").first();
  const row = button.locator("..").locator("..");
  const routeId = await row.getAttribute("data-recommendation-route");
  const target = await row.locator("td").nth(1).locator("strong").innerText();
  await button.click();
  await expect(page.getByLabel("Маршрут для управления")).toHaveValue(routeId!);
  await expect(page.getByLabel("Плановое количество автобусов")).toHaveValue(
    target,
  );
  await expect(page.getByLabel("Плановая стоянка")).toHaveValue("20");
  await expect(page.locator(".dispatch-context")).toContainText("8 на линии");
  await expect(page.locator(".dispatch-journal")).not.toContainText(
    "Применён в демо",
  );
  await page.getByLabel("Плановое количество автобусов").fill("11");
  await page.waitForTimeout(1200);
  await expect(page.getByLabel("Плановое количество автобусов")).toHaveValue(
    "11",
  );
  await page
    .getByRole("button", { name: "Подставить подсказки", exact: true })
    .click();
  await expect(page.getByLabel("Плановое количество автобусов")).toHaveValue(
    target,
  );
  await page
    .getByRole("button", { name: "Применить в демо", exact: true })
    .click();
  await expect(page.locator(".dispatch-journal")).toContainText(
    "Применён в демо",
  );
  await expect(
    page.locator(`tr[data-recommendation-route="${routeId}"]`),
  ).toContainText("Уже применён");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Включить светлую тему" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("dispatcher queue searches, filters and resets a draft", async ({ page }) => {
  await page.goto("/dispatch?visual-test=1");
  const queue = page.locator(".dispatch-queue-item");
  await expect(queue).toHaveCount(15);
  await page.getByLabel("Поиск маршрута в диспетчерской").fill("м6");
  await expect(queue).toHaveCount(1);
  await queue.click();
  await expect(page.getByLabel("Маршрут для управления")).toHaveValue("м6");
  await page.getByLabel("Плановое количество автобусов").fill("11");
  await page.getByRole("button", { name: "Сбросить правки" }).click();
  await expect(page.getByLabel("Плановое количество автобусов")).toHaveValue("8");
  await page.getByLabel("Поиск маршрута в диспетчерской").fill("");
  await page.locator(".dispatch-queue-filters").getByRole("button", { name: "С предложением" }).click();
  await expect(queue).toHaveCount(5);
  await page.locator(".dispatch-queue-filters").getByRole("button", { name: "Активные" }).click();
  await expect(queue).toHaveCount(0);
  await expect(page.locator(".dispatch-queue-empty")).toBeVisible();
});

test("dispatcher keeps plans available when the live stream is offline", async ({ page }) => {
  await page.goto("/overview?debug=1&visual-test=1");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("button", { name: "Открыть сценарии демонстрации" }).click();
  await page.getByLabel("Отключить поток").check();
  await page.getByRole("button", { name: "Закрыть карточку" }).click();
  await page.getByRole("link", { name: "Диспетчер", exact: true }).click();
  await expect(page.locator(".dispatch-live.offline")).toBeVisible();
  await page.getByLabel("Плановое количество автобусов").fill("10");
  await expect(page.getByRole("button", { name: "Применить в демо", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Сохранить только план" }).click();
  await expect(page.locator(".dispatch-journal")).toContainText("План");
});
