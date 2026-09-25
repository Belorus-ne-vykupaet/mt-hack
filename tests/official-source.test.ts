import { afterEach, expect, it, vi } from "vitest";
import { OfficialSource, type OfficialSnapshot } from "../server/official";

const snapshot = (timestamp: string) =>
  ({
    vehicles: [],
    routes: [],
    alerts: [],
    segments: [],
    points: [],
    geometries: [],
    summary: { timestamp },
  }) as unknown as OfficialSnapshot;

afterEach(() => vi.restoreAllMocks());

it("coalesces a slow refresh and serves the previous snapshot without waiting", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  let finish!: (response: Response) => void;
  const fetcher = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json(snapshot("first")))
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const source = new OfficialSource("http://backend", []);
  const first = await source.snapshot();
  first.summary.timestamp = "caller mutation";
  expect((await source.snapshot()).summary.timestamp).toBe("first");

  now = 1001;
  const reads = await Promise.all(Array.from({ length: 50 }, () => source.snapshot()));
  expect(reads.every((item) => item.summary.timestamp === "first")).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  finish(Response.json(snapshot("second")));
  await vi.waitFor(() => expect(source.diagnostics().cacheAgeMs).toBe(0));
  expect((await source.snapshot()).summary.timestamp).toBe("second");
  expect(source.diagnostics().stale).toBe(false);
});

it("bounds failed upstream retries and automatically recovers", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const fetcher = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json(snapshot("first")))
    .mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValueOnce(new Error("still offline"))
    .mockResolvedValueOnce(Response.json(snapshot("recovered")));
  const source = new OfficialSource("http://backend", []);
  await source.snapshot();
  now = 1001;
  expect((await source.snapshot()).summary.timestamp).toBe("first");
  await vi.waitFor(() => expect(source.diagnostics().consecutiveFailures).toBe(1));
  await Promise.all(Array.from({ length: 50 }, () => source.snapshot()));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(source.diagnostics().stale).toBe(true);
  expect(source.diagnostics().retryInMs).toBe(1000);

  now = 2001;
  expect((await source.snapshot()).summary.timestamp).toBe("first");
  await vi.waitFor(() => expect(source.diagnostics().consecutiveFailures).toBe(2));
  expect(source.diagnostics().retryInMs).toBe(2000);
  now = 4001;
  expect((await source.snapshot()).summary.timestamp).toBe("first");
  await vi.waitFor(() => expect(source.diagnostics().stale).toBe(false));
  expect((await source.snapshot()).summary.timestamp).toBe("recovered");
  expect(source.diagnostics().consecutiveFailures).toBe(0);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("fails fast during cold-start retry cooldown", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  const source = new OfficialSource("http://backend", []);
  await expect(source.snapshot()).rejects.toThrow("offline");
  await expect(source.snapshot()).rejects.toThrow("retry cooldown");
  expect(fetcher).toHaveBeenCalledTimes(1);
  now = 1000;
  await expect(source.snapshot()).rejects.toThrow("offline");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("rejects a partial upstream response without corrupting the last complete snapshot", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json(snapshot("complete")))
    .mockResolvedValueOnce(Response.json({
      ...snapshot("partial"), geometries: undefined,
    }));
  const source = new OfficialSource("http://backend", []);
  await source.snapshot();
  now = 1001;
  expect((await source.snapshot()).summary.timestamp).toBe("complete");
  await vi.waitFor(() => expect(source.diagnostics().stale).toBe(true));
  expect((await source.snapshot()).summary.timestamp).toBe("complete");
});
