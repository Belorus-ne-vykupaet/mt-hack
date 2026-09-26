import { test, expect } from "@playwright/test";

test("the dashboard is installable as an app and offers install from the header", async ({
  page,
  request,
}) => {
  await page.goto("/dispatch?visual-test=1");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await request.get(href!)).json();
  expect(manifest).toMatchObject({
    short_name: "Transit Hub",
    start_url: "/overview",
    display: "standalone",
  });
  expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual([
    "/overview",
    "/analytics",
    "/dispatch",
  ]);
  for (const icon of manifest.icons)
    expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
  expect(
    manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable"),
  ).toBe(true);

  const install = page.getByRole("button", { name: "Установить" });
  await expect(page.locator(".header")).toBeVisible();
  await expect(install).toHaveCount(0);
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        (window as unknown as { prompted: boolean }).prompted = true;
      },
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    window.dispatchEvent(event);
  });
  await install.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted))
    .toBe(true);
  await expect(install).toHaveCount(0);
});

test("the header offers the Android app and the site serves a real APK", async ({
  page,
  request,
}) => {
  await page.goto("/overview?visual-test=1");
  const link = page.getByRole("link", { name: "Скачать APK" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/downloads/transit-hub.apk");
  await expect(link).toHaveAttribute("download", "transit-hub.apk");
  const response = await request.get("/downloads/transit-hub.apk");
  expect(response.ok()).toBe(true);
  const body = await response.body();
  // An APK is a ZIP archive with the Android manifest inside, not the SPA fallback page.
  expect(body.subarray(0, 2).toString()).toBe("PK");
  expect(body.includes(Buffer.from("AndroidManifest.xml"))).toBe(true);
  expect(body.length).toBeGreaterThan(1_000_000);
});
