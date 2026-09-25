import { it, expect } from "vitest";
import {
  buildStopColumns,
  columnLabel,
  columnTooltip,
} from "../src/entities/map-columns";
import { mapRoute, mapSegment } from "../src/entities/adapters";
import { scenarioSnapshot } from "../src/mocks/scenario";
it("anchors each column to a named stop on its route and identifies the local delay", () => {
  const snapshot = scenarioSnapshot(30);
  const routes = snapshot.routes.map(mapRoute);
  const columns = buildStopColumns(
    snapshot.segments.map(mapSegment),
    routes,
    7.5,
  );
  expect(columns.length).toBeGreaterThan(100);
  expect(new Set(columns.map((c) => c.id)).size).toBe(columns.length);
  for (const c of columns) {
    expect(c.route.stops.some((s) => s.id === c.stop.id)).toBe(true);
    expect(c.position).toEqual([c.stop.position.lon, c.stop.position.lat]);
    expect(columnLabel(c)).toContain(c.stop.name);
    expect(columnLabel(c)).toContain(`№ ${c.route.number}`);
    expect(columnTooltip(c, 7.5)).toContain("+7 мин 30 с");
    expect(columnTooltip(c, 7.5)).toContain("Задержка на участке у остановки");
  }
});
it("merges columns sharing a stop using the largest local delay, not route-wide risk", () => {
  const s = scenarioSnapshot(30);
  const route = mapRoute(s.routes[0]);
  route.stops = route.stops.slice(0, 1);
  const normal = {
    ...mapSegment(s.segments[0]),
    riskLevel: "normal" as const,
    riskProbability: 0.05,
    currentDelaySec: 12,
    predictedDelaySec: 24,
  };
  const severe = {
    ...normal,
    id: "severe",
    riskLevel: "critical" as const,
    riskProbability: 0.91,
    currentDelaySec: 138,
    predictedDelaySec: 504,
  };
  const columns = buildStopColumns([severe, normal], [route], 15);
  expect(columns).toHaveLength(1);
  expect(columns[0].delay).toBe(504);
  expect(columns[0].riskProbability).toBe(0.91);
  expect(buildStopColumns([normal], [route], 15)[0].riskLevel).toBe("normal");
  expect(buildStopColumns([normal], [{ ...route, stops: [] }], 15)).toEqual([]);
});

it("keeps station labels apart and prioritizes the selected route", async () => {
  const { visibleColumnLabels } = await import("../src/entities/map-columns");
  const s = scenarioSnapshot(30);
  const columns = buildStopColumns(
    s.segments.map(mapSegment),
    s.routes.map(mapRoute),
    15,
  );
  const chosen = columns.find((c) => c.routeId === "с344")!;
  const visible = visibleColumnLabels(
    [columns[0], chosen],
    () => [600, 350],
    1000,
    700,
    "с344",
  );
  expect(visible.map((c) => c.id)).toEqual([chosen.id]);
  expect(
    visibleColumnLabels(columns, () => [-50, -50], 1000, 700, null),
  ).toEqual([]);
});
