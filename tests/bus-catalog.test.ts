import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRoute } from "../scripts/lib/bus-catalog.mjs";
import catalog from "../src/data/moscow-buses.json";
import { positionAt } from "../src/mocks/scenario";
const network = JSON.parse(
  readFileSync(
    new URL("../admin/data/bus-network.json", import.meta.url),
    "utf8",
  ),
);
describe("bus paths and administration", () => {
  it("every published segment follows an imported directed road edge and all stops lie on it", () => {
    const edges = new Set(network.edges.map((e: string[]) => e.join(":")));
    for (const route of catalog.routes) {
      expect(route.coordinates.length).toBeGreaterThanOrEqual(
        route.relationId ? 100 : 2,
      );
      expect(route.stops.length).toBeGreaterThanOrEqual(
        2,
      );
      route.nodeIds.forEach((id, i) => {
        expect(route.coordinates[i]).toEqual(network.nodes[id]);
        if (i) expect(edges.has(`${route.nodeIds[i - 1]}:${id}`)).toBe(true);
      });
      let previous = -1;
      for (const stop of route.stops) {
        const index = route.nodeIds.indexOf(stop.id);
        expect(index).toBeGreaterThanOrEqual(previous);
        previous = index;
        expect(route.coordinates[index]).toEqual([
          stop.position.lon,
          stop.position.lat,
        ]);
      }
    }
  });
  it("constructs a route through requested stops using road geometry, rejects disconnected or repeated stops", () => {
    const stops = catalog.routes[0].stops.slice(0, 3).map((s) => s.id);
    const route = createRoute(network, { number: "test", stopIds: stops });
    expect(route.stops.map((s) => s.id)).toEqual(stops);
    expect(route.coordinates.length).toBeGreaterThan(3);
    expect(() =>
      createRoute(network, { number: "test", stopIds: [stops[0], stops[0]] }),
    ).toThrow();
    expect(() =>
      createRoute(network, { number: "test", stopIds: [stops[0], "missing"] }),
    ).toThrow();
    expect(() =>
      createRoute({ ...network, edges: [] }, {
        number: "test",
        stopIds: [stops[0], stops[1]],
      }),
    ).toThrow(/Нет связного пути/);
  });
  it("dry run and rejected replacement leave the catalog unchanged", () => {
    const before = readFileSync(
      new URL("../src/data/moscow-buses.json", import.meta.url),
      "utf8",
    );
    const args = [
      "scripts/routes-admin.mjs",
      "add",
      "--number",
      "м3",
      "--stops",
      catalog.routes[0].stops
        .slice(0, 3)
        .map((s) => s.id)
        .join(","),
    ];
    expect(() =>
      execFileSync(process.execPath, args, { stdio: "pipe" }),
    ).toThrow();
    const output = execFileSync(
      process.execPath,
      [...args, "--replace", "--dry-run"],
      { encoding: "utf8" },
    );
    expect(output).toContain("без сохранения");
    expect(
      readFileSync(
        new URL("../src/data/moscow-buses.json", import.meta.url),
        "utf8",
      ),
    ).toBe(before);
  });
  it("interpolates vehicles on actual path segments rather than chords between stops", () => {
    catalog.routes.forEach((route, i) => {
      for (const progress of [0, 0.123, 0.5, 0.875, 0.999]) {
        const p = positionAt(i, progress);
        const onSegment = route.coordinates.slice(1).some((b, j) => {
          const a = route.coordinates[j];
          const dx = b[0] - a[0],
            dy = b[1] - a[1];
          const t =
            ((p.lon - a[0]) * dx + (p.lat - a[1]) * dy) / (dx * dx + dy * dy);
          return (
            t >= -1e-7 &&
            t <= 1 + 1e-7 &&
            Math.hypot(p.lon - a[0] - t * dx, p.lat - a[1] - t * dy) < 1e-8
          );
        });
        expect(onSegment).toBe(true);
      }
    });
  });
});
