import { expect, test, type Page } from "@playwright/test";
import { WEATHER_LOCATIONS } from "../../src/entities/weather-current";
async function mockWeather(
  page: Page,
  configured: boolean,
  now = Date.now(),
  wet = true,
) {
  const snapshot = {
    schemaVersion: 1,
    source: "Яндекс Погода",
    mode: "current-points",
    fetchedAt: new Date(now).toISOString(),
    refreshAfterSec: 900,
    unavailablePoints: [],
    points: WEATHER_LOCATIONS.map((p) => ({
      ...p,
      cloudiness: "OVERCAST",
      precipitationType:
        wet && ["center", "inner_nw", "n"].includes(p.id) ? "RAIN" : "NO_TYPE",
      precipitationStrength:
        wet && ["center", "inner_nw", "n"].includes(p.id) ? "STRONG" : "ZERO",
    })),
  };
  await page.addInitScript(
    ({ configured, snapshot }) => {
      const original = window.fetch,
        requests: string[] = [];
      (window as unknown as { weatherRequests: string[] }).weatherRequests =
        requests;
      window.fetch = (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.includes("/external/yandex-weather/"))
          return original(input, init);
        requests.push(url);
        if (url.endsWith("/status"))
          return Promise.resolve(Response.json({ configured }));
        if (url.endsWith("/current"))
          return Promise.resolve(Response.json(snapshot));
        return Promise.resolve(
          new Response("Unexpected Nowcast request", { status: 403 }),
        );
      };
    },
    { configured, snapshot },
  );
}
test("weather has independent persistent switches and explains missing Yandex access", async ({
  page,
}) => {
  await mockWeather(page, false);
  await page.goto("/flow?visual-test=1");
  await page.getByRole("button", { name: "Погода на 3D-карте" }).click();
  const panel = page.getByRole("region", { name: "Настройки погоды" });
  await expect(panel).toContainText("пока не подключена");
  await page.getByLabel("Облака", { exact: true }).uncheck();
  await page.getByLabel("Дождь и осадки", { exact: true }).uncheck();
  await page.reload();
  await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
  await page.getByRole("button", { name: "Погода на 3D-карте" }).click();
  await expect(page.getByLabel("Облака", { exact: true })).not.toBeChecked();
  await page
    .getByRole("switch", { name: "Погодный слой", exact: true })
    .uncheck();
  await expect(page.locator(".weather-control")).toHaveAttribute(
    "data-weather-active",
    "false",
  );
  await expect(page.getByLabel("Облака", { exact: true })).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { weatherRequests: string[] }
      ).weatherRequests.filter((url) => /current|timeline|tiles/.test(url)),
    ),
  ).toEqual([]);
});
test("current point clouds render, stay independent of forecast and survive theme and mode changes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /THREE|Shader Error|GLSL/.test(m.text()))
      errors.push(m.text());
  });
  const now = Date.now();
  await mockWeather(page, true, now);
  await page.goto("/flow?visual-test=1");
  await expect(page.locator(".weather-control")).toHaveAttribute(
    "data-weather-active",
    "true",
    { timeout: 60000 },
  );
  await expect
    .poll(async () =>
      Number(
        await page
          .locator(".maplibregl-canvas")
          .getAttribute("data-weather-rendered"),
      ),
    )
    .toBeGreaterThan(0);
  await page.screenshot({ path: "/private/tmp/transit-weather-light.png" });
  await page.getByRole("button", { name: "Погода на 3D-карте" }).click();
  await page.screenshot({ path: "/private/tmp/transit-weather-panel.png" });
  await page.getByLabel("Выразительность погоды").fill("0.95");
  await page.getByRole("button", { name: "Закрыть настройки погоды" }).click();
  await page.getByLabel("Горизонт прогноза в минутах").fill("10");
  await expect(page.locator(".weather-control")).toHaveAttribute(
    "data-weather-time",
    new Date(now).toISOString(),
  );
  const requests = await page.evaluate(
    () => (window as unknown as { weatherRequests: string[] }).weatherRequests,
  );
  expect(requests.filter((url) => url.endsWith("/current"))).toHaveLength(1);
  expect(requests.some((url) => /timeline|tiles/.test(url))).toBe(false);
  await expect(page.locator(".weather-control")).toHaveAttribute(
    "data-weather-rain-points",
    "3",
  );
  await page.getByRole("button", { name: "Включить тёмную тему" }).click();
  await expect(page.locator(".weather-control")).toHaveAttribute(
    "data-weather-active",
    "true",
  );
  await page.screenshot({ path: "/private/tmp/transit-weather-dark.png" });
  for (let i = 0; i < 4; i++)
    await page
      .getByRole("button", {
        name: `Переключить карту в ${i % 2 ? "3D" : "2D"}`,
      })
      .click();
  await expect(page.locator(".weather-control")).toHaveAttribute(
    "data-weather-active",
    "true",
  );
  await page.getByRole("button", { name: "Погода на 3D-карте" }).click();
  await page
    .getByRole("switch", { name: "Погодный слой", exact: true })
    .uncheck();
  await expect(page.locator(".weather-control")).toHaveAttribute(
    "data-weather-active",
    "false",
  );
  await page.getByRole("button", { name: "Закрыть настройки погоды" }).click();
  await page.screenshot({ path: "/private/tmp/transit-weather-off.png" });
  expect(errors).toEqual([]);
});

test("dry and stale weather do not invent rain; mobile controls remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockWeather(page, true, Date.now(), false);
  await page.goto("/flow?visual-test=1");
  await expect(page.locator(".weather-control")).toHaveAttribute(
    "data-weather-active",
    "true",
  );
  await expect(page.locator(".weather-control")).toHaveAttribute(
    "data-weather-rain-points",
    "0",
  );
  await expect(page.locator(".maplibregl-canvas")).toHaveAttribute(
    "data-weather-cloud-tiles",
    "0",
  );
  await expect(page.locator(".maplibregl-canvas")).toHaveAttribute(
    "data-weather-rain-tiles",
    "0",
  );
  await page.getByRole("button", { name: "Погода на 3D-карте" }).click();
  await expect(
    page.getByText("В проверенных точках дождя нет", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Анимация атмосферы")).toBeDisabled();
  await page.getByText("Погода по районам · 13 точек", { exact: true }).click();
  await expect(page.locator(".weather-point")).toHaveCount(13);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mockWeather(page, true, Date.now() - 3600000);
  await page.goto("/flow?visual-test=1");
  await page.getByRole("button", { name: "Погода на 3D-карте" }).click();
  await expect(page.locator(".weather-status")).toContainText("устарели");
  await expect(page.locator(".weather-control")).toHaveAttribute(
    "data-weather-active",
    "false",
  );
});

test("weather releases global listeners across theme, 2D/3D and page changes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockWeather(page, true);
  await page.addInitScript(() => {
    const contexts = HTMLCanvasElement.prototype.getContext;
    const tracked = new WeakSet<HTMLCanvasElement>();
    const canvases: WeakRef<HTMLCanvasElement>[] = [];
    HTMLCanvasElement.prototype.getContext = function (
      ...args: Parameters<typeof contexts>
    ) {
      const result = contexts.apply(this, args);
      if (String(args[0]).startsWith("webgl") && result && !tracked.has(this)) {
        tracked.add(this);
        canvases.push(new WeakRef(this));
      }
      return result;
    } as typeof contexts;
    Object.defineProperty(window, "retainedMapCanvases", {
      get: () =>
        canvases.filter((ref) =>
          ref.deref()?.classList.contains("maplibregl-canvas"),
        ).length,
    });
    const mqAdd = MediaQueryList.prototype.addEventListener;
    const mqRemove = MediaQueryList.prototype.removeEventListener;
    const mqListeners = new WeakMap<MediaQueryList, WeakSet<object>>();
    let liveResolution = 0;
    Object.defineProperty(window, "liveResolutionListeners", {
      get: () => liveResolution,
    });
    MediaQueryList.prototype.addEventListener = function (
      type,
      listener,
      options,
    ) {
      if (type === "change" && this.media.includes("resolution") && listener) {
        let set = mqListeners.get(this);
        if (!set) {
          set = new WeakSet();
          mqListeners.set(this, set);
        }
        if (!set.has(listener)) {
          set.add(listener);
          liveResolution++;
        }
      }
      mqAdd.call(this, type, listener, options);
    };
    MediaQueryList.prototype.removeEventListener = function (
      type,
      listener,
      options,
    ) {
      if (
        type === "change" &&
        listener &&
        mqListeners.get(this)?.delete(listener)
      )
        liveResolution--;
      mqRemove.call(this, type, listener, options);
    };
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    const listeners = new WeakSet<object>();
    let live = 0;
    Object.defineProperty(window, "liveVisibilityListeners", {
      get: () => live,
    });
    document.addEventListener = (type, listener, options) => {
      if (type === "visibilitychange" && listener && !listeners.has(listener)) {
        listeners.add(listener);
        live++;
      }
      add(type, listener, options);
    };
    document.removeEventListener = (type, listener, options) => {
      if (type === "visibilitychange" && listener && listeners.delete(listener))
        live--;
      remove(type, listener, options);
    };
  });
  const live = () =>
    page.evaluate(
      () =>
        (window as unknown as { liveVisibilityListeners: number })
          .liveVisibilityListeners,
    );
  await page.goto("/analytics?visual-test=1");
  await expect(
    page.getByRole("link", { name: "Обзор сети", exact: true }),
  ).toBeVisible();
  const resolution = () =>
    page.evaluate(
      () =>
        (window as unknown as { liveResolutionListeners: number })
          .liveResolutionListeners,
    );
  const baseline = await live();
  const resolutionBaseline = await resolution();
  await page.getByRole("link", { name: "Обзор сети", exact: true }).click();
  await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
  await expect(page.locator(".weather-control")).toHaveAttribute(
    "data-weather-active",
    "true",
  );
  const active = await live();
  const activeResolution = await resolution();
  expect(activeResolution).toBeGreaterThan(resolutionBaseline);
  for (let i = 0; i < 8; i++) {
    await page
      .getByRole("button", {
        name: i % 2 ? "Включить светлую тему" : "Включить тёмную тему",
      })
      .click();
    await expect(page.locator(".weather-control")).toHaveAttribute(
      "data-weather-active",
      "true",
    );
    await page.getByRole("button", { name: "Переключить карту в 2D" }).click();
    await page.getByRole("button", { name: "Переключить карту в 3D" }).click();
    await expect(page.locator(".weather-control")).toHaveAttribute(
      "data-weather-active",
      "true",
    );
    await expect.poll(live).toBe(active);
    await expect.poll(resolution).toBe(activeResolution);
  }
  await page.getByRole("link", { name: "Аналитика", exact: true }).click();
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
  await expect.poll(live).toBe(baseline);
  await expect.poll(resolution).toBe(resolutionBaseline);
  // Force collection only in the test. WeakRefs do not retain the removed canvases.
  const cdp = await page.context().newCDPSession(page);
  await expect
    .poll(
      async () => {
        await cdp.send("HeapProfiler.collectGarbage");
        return page.evaluate(
          () =>
            (window as unknown as { retainedMapCanvases: number })
              .retainedMapCanvases,
        );
      },
      { timeout: 15000 },
    )
    .toBe(0);
  await cdp.detach();
  expect(errors).toEqual([]);
});
