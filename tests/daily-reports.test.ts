import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DailyReports } from "../server/daily-reports";
import { createApi } from "../server/app";
import type { VehicleDto } from "../src/shared/api/generated/models";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const done of cleanup.splice(0).reverse()) await done(); });
const bus = (id: string, prediction: number | null) => ({
  id, route_id: "route-1", predicted_delay_sec: prediction,
  forecast_status: prediction === null ? "no_schedule" : "ready",
}) as VehicleDto;

describe("daily dispatch reports", () => {
  it("keeps one sample per archive minute, persists days and marks stale AI text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "daily-reports-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, "reports.json"), store = new DailyReports(file);
    store.observe("2026-01-06T07:30:05Z", [bus("1", 180), bus("2", null)], true);
    store.observe("2026-01-06T07:30:50Z", [bus("1", 900)], true);
    store.observe("2026-01-06T07:31:00Z", [bus("1", 60), bus("3", 130)], true);
    expect(store.list()[0]).toMatchObject({ date: "2026-01-06", samples: 2,
      metrics: { vehiclesObserved: 3, vehiclesWithForecast: 2, peakDelayedVehicles: 1, peakPredictedDelaySec: 180 },
      source: "rules" });
    expect(store.list()[0].coverageNote).toContain("не является итогом полного дня");
    store.saveNarrative("2026-01-06", "Отчёт по двум срезам.", ["Проверить автобусы с риском."], "GigaChat-3-Ultra");
    store.observe("2026-01-06T07:32:00Z", [bus("1", 220)], true);
    store.observe("2026-01-05T23:58:00Z", [bus("4", 0)], true);
    expect(store.list().map((day) => day.date)).toEqual(["2026-01-06", "2026-01-05"]);
    expect(new DailyReports(file).get("2026-01-06")).toMatchObject({
      source: "gigachat", needsRefresh: true, basedOnSamples: 2, samples: 3,
    });
    expect((await readFile(file, "utf8"))).not.toContain("authorization");
  });

  it("generates via Ultra only on an authorized POST and saves the result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "daily-api-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const calls: { url: string; body?: string }[] = [];
    const fakeFetch = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      calls.push({ url: String(input), body: String(options?.body || "") });
      if (String(input).includes("oauth")) return Response.json({ access_token: "unit-token", expires_at: Math.floor(Date.now() / 1000) + 1800 });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: "По наблюдённым срезам есть риск задержки; охват дня неполный.", highlights: ["Проверить автобусы с высоким прогнозом."] }) } }] });
    });
    const token = "daily-report-secret-for-tests";
    const api = createApi({ frozen: true, reportStore: join(dir, "reports.json"), token, publicRead: true,
      gigachatKey: "fake-auth", gigachatFetcher: fakeFetch as typeof fetch });
    await new Promise<void>((resolve) => api.server.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => api.close());
    const url = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api/v1/dispatch/reports`;
    const list = await (await fetch(url)).json();
    expect(list.model).toBe("GigaChat-3-Ultra");
    expect(list.items).toHaveLength(1);
    expect(list.items[0].source).toBe("rules");
    expect(calls).toHaveLength(0);
    const date = list.items[0].date;
    expect((await fetch(`${url}/${date}/generate`, { method: "POST" })).status).toBe(401);
    const generated = await (await fetch(`${url}/${date}/generate`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })).json();
    expect(generated.source).toBe("gigachat");
    expect(generated.summary).toContain("охват дня неполный");
    expect(calls.filter((call) => call.url.includes("chat/completions"))).toHaveLength(1);
    const body = JSON.parse(calls.find((call) => call.url.includes("chat/completions"))!.body!);
    expect(body.model).toBe("GigaChat-3-Ultra");
    expect(body.messages[1].content).toContain("coverage");
    expect(body.messages[1].content).not.toContain("meanPredictedDelaySec");
    expect((await (await fetch(`${url}/${date}`)).json()).source).toBe("gigachat");
    await fetch(`${url}/${date}/generate`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect(calls.filter((call) => call.url.includes("chat/completions"))).toHaveLength(1);
  });
});
