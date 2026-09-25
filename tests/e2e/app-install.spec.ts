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
