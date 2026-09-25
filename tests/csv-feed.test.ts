import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import {
  normalizeFeed,
  parseCsv,
  readTables,
  timestamp,
} from "../scripts/lib/csv-feed.mjs";
import { contextAt } from "../scripts/lib/external-context.mjs";
import { csvSnapshot } from "../src/mocks/csv-scenario";
const profile = JSON.parse(
  await readFile("admin/csv/profiles/default.json", "utf8"),
);
const tables = await readTables("admin/csv/example", profile);
describe("hackathon CSV adapter", () => {
  it("imports both header/unit conventions into the same routes and telemetry", async () => {
    const ru = JSON.parse(
      await readFile("admin/csv/profiles/russian.json", "utf8"),
    );
    const a = normalizeFeed(tables, profile),
      b = normalizeFeed(await readTables("admin/csv/example", ru), ru);
    expect(a.routes).toHaveLength(15);
    expect(a.trips).toHaveLength(120);
    expect(a.observations).toHaveLength(3720);
    expect(b.routes).toEqual(a.routes);
    expect(b.geometries).toEqual(a.geometries);
    a.observations.forEach((v: any, i: number) => {
      expect(b.observations[i].id).toBe(v.id);
      expect(b.observations[i].updated_at).toBe(v.updated_at);
      expect(b.observations[i].current_delay_sec).toBeCloseTo(
        v.current_delay_sec,
      );
      expect(b.observations[i].speed_kmh).toBeCloseTo(v.speed_kmh);
      expect(b.observations[i].position).toEqual(v.position);
    });
  });
  it("preserves quoted delimiters, newlines, BOM and leading-zero identifiers", () => {
    const result = parseCsv(
      '\uFEFFid;name\r\n0007;"Остановка; ""Северная""\nМосква"\r\n',
      ";",
    );
    expect(result.rows[0]).toEqual({
      id: "0007",
      name: 'Остановка; "Северная"\nМосква',
    });
    for (const input of ["a,a\n1,2", "a,b\n1", 'a,b\n"x,y', 'a,b\n"x"q,y'])
      expect(() => parseCsv(input)).toThrow();
  });
  it("handles explicit timezone and midnight, rejecting ambiguous dates", () => {
    expect(timestamp("2026-09-24 00:10:00", "local", "+03:00")).toBe(
      "2026-09-23T21:10:00.000Z",
    );
    expect(() => timestamp("2026-09-23 12:00:00")).toThrow();
    expect(() => timestamp("2026-02-30T12:00:00Z")).toThrow();
    expect(timestamp("0", "unix_s")).toBe("1970-01-01T00:00:00.000Z");
  });
  it("rejects orphan IDs, duplicates, empty numerics, invalid coordinates and backwards schedules", () => {
    for (const mutate of [
      (t: any) => (t.telemetry[0].trip_id = "missing"),
      (t: any) => (t.telemetry[0].speed = ""),
      (t: any) => (t.telemetry[0].lat = "99"),
      (t: any) => t.telemetry.push(t.telemetry[0]),
      (t: any) => (t.schedule[1].stop_sequence = t.schedule[0].stop_sequence),
      (t: any) => (t.schedule[0].departure_time = "2020-01-01T00:00:00Z"),
    ]) {
      const copy = structuredClone(tables);
      mutate(copy);
      expect(() => normalizeFeed(copy, profile)).toThrow();
    }
  });
  it("replays only past observations and freezes on the final record", () => {
    const first = csvSnapshot(0),
      next = csvSnapshot(60),
      last = csvSnapshot(999999);
    expect(first.vehicles).toHaveLength(120);
    expect(first.vehicles[0].predicted_delay_sec).toBe(
      first.vehicles[0].current_delay_sec,
    );
    expect(
      first.vehicles.every(
        (v) => Date.parse(v.updated_at) <= Date.parse(first.summary.timestamp),
      ),
    ).toBe(true);
    expect(
      next.vehicles.find((v) => v.id === "vehicle-742")!.current_delay_sec,
    ).toBeGreaterThan(
      first.vehicles.find((v) => v.id === "vehicle-742")!.current_delay_sec,
    );
    expect(last.summary.timestamp).toBe("2026-09-23T07:30:00.000Z");
    expect(first.segments).toEqual([]);
    for (const alert of last.alerts) {
      const bus = last.vehicles.find((v) => v.id === alert.vehicle_id)!;
      expect(bus.current_delay_sec).toBe(alert.predicted_delay_sec);
    }
  });
});
it("external features cannot see future arrivals, stale cache or another route", () => {
  const good = {
    kind: "traffic",
    source: "test",
    routeId: "м3",
    availableAt: "2026-09-23T07:00:00Z",
    validFrom: "2026-09-23T07:00:00Z",
    validTo: "2026-09-23T07:20:00Z",
    expiresAt: "2026-09-23T07:05:00Z",
    values: { travelTimeRatio: 1.4 },
  };
  const query = {
    routeId: "м3",
    issuedAt: "2026-09-23T07:01:00Z",
    targetAt: "2026-09-23T07:15:00Z",
  };
  expect(contextAt([good], query).trafficTravelTimeRatio).toBe(1.4);
  for (const patch of [
    { availableAt: "2026-09-23T07:02:00Z" },
    { expiresAt: "2026-09-23T07:00:00Z" },
    { routeId: "м40" },
    { validTo: "2026-09-23T07:10:00Z" },
  ])
    expect(contextAt([{ ...good, ...patch }], query).trafficMissing).toBe(true);
  expect(contextAt([], query)).toMatchObject({
    weatherMissing: true,
    trafficMissing: true,
    precipitationMm: null,
  });
});
