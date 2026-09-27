import { expect, it } from "vitest";
import { attentionEvents } from "../src/entities/attention-events";
import type { Alert, Vehicle } from "../src/entities/models";

const bus: Vehicle = {
  id: "vehicle-3", routeId: "route-3", position: { lat: 55.7, lon: 37.6 }, speedKmh: 20,
  currentDelaySec: -60, predictedDelaySec: -90, riskLevel: "elevated", riskProbability: .02,
  hasForecast: true, nextStop: null, updatedAt: "2026-01-06T07:27:00Z",
  forecastTargetTime: "2026-01-06T07:39:00Z",
};
const warning = (id: string): Alert => ({
  id: `warning-${id}`, routeId: `route-${id}`, vehicleId: `vehicle-${id}`, severity: "warning",
  title: "Риск опоздания", description: "", predictedDelaySec: 180, riskProbability: .7,
  createdAt: bus.updatedAt, eventType: "late_threshold", eventLeadTimeSec: 780,
});
it("includes the third early bus alongside two published late warnings", () => {
  const published = [warning("1"), warning("2")];
  const events = attentionEvents(published, [bus]);
  expect(events).toHaveLength(3);
  expect(events.slice(0, 2)).toEqual(published);
  expect(events[2]).toMatchObject({ attentionKind: "early_arrival", title: "Раннее прибытие", predictedDelaySec: -90,
    expectedArrivalAt: "2026-01-06T07:37:30.000Z" });
  expect(events[2].eventType).toBeUndefined();
  expect(events[2].eventLeadTimeSec).toBeUndefined();
});
it("does not duplicate a published event or its immutable issue time", () => {
  const published = warning("3");
  expect(attentionEvents([published], [bus, bus])).toEqual([published]);
});
it("excludes unavailable, stale and normal predictions and drops resolved early arrivals", () => {
  for (const change of [{hasForecast: false}, {telemetryStale: true}, {riskLevel: "unknown" as const},
    {riskLevel: "normal" as const, predictedDelaySec: 0}]) {
    expect(attentionEvents([], [{...bus, ...change}])).toEqual([]);
  }
});
it("includes probability-driven risk without inventing a published warning time", () => {
  const event = attentionEvents([], [{...bus, predictedDelaySec: 80, riskProbability: .7}])[0];
  expect(event.attentionKind).toBe("forecast_risk");
  expect(event.title).toBe("Риск опоздания");
  expect(event.eventLeadTimeSec).toBeUndefined();
});
