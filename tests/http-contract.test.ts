import catalog from "../src/data/moscow-buses.json";
import { beforeAll, afterAll, it, expect } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "../src/mocks/handlers";
import { loaders } from "../src/entities/queries";
import {
  getRouteGeometry,
  getVehicleForecast,
} from "../src/shared/api/generated/endpoints";
import { simulation } from "../src/mocks/scenario";
const server = setupServer(...handlers);
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  simulation.seconds = 30;
});
afterAll(() => server.close());
it("generated REST client reaches mock HTTP and adapts authoritative snapshots", async () => {
  const [routes, vehicles, summary, alerts, series] = await Promise.all([
    loaders.routes(),
    loaders.vehicles(),
    loaders.summary(),
    loaders.alerts(),
    loaders.series(),
  ]);
  expect(routes).toHaveLength(catalog.routes.length);
  expect(vehicles).toHaveLength(
    catalog.routes.reduce((n, r) => n + r.vehicleCount, 0),
  );
  expect(summary.vehiclesActive).toBe(
    catalog.routes.reduce((n, r) => n + r.vehicleCount, 0),
  );
  expect(alerts[0].riskProbability).toBe(0.91);
  expect(series.at(-1)?.actualDelaySec).toBeNull();
  expect(series.at(-1)?.predictedDelaySec).toBeTypeOf("number");
});
it("geometry and vehicle forecast share the contract and explicit units", async () => {
  const geometry = await getRouteGeometry("м3");
  expect(geometry.status).toBe(200);
  if (geometry.status === 200) {
    expect(geometry.data.geometry.coordinates[0]).toEqual(
      catalog.routes[0].coordinates[0],
    );
  }
  const f = await getVehicleForecast("vehicle-742");
  if (f.status === 200) {
    expect(f.data.points.at(-1)?.offset_sec).toBe(900);
    expect(f.data.points.at(-1)?.predicted_delay_sec).toBe(504);
  } else throw new Error("Forecast request failed");
});
it("a REST failure rejects without silently replacing cache with an error DTO", async () => {
  simulation.error = true;
  await expect(loaders.summary()).rejects.toThrow("503");
  simulation.error = false;
});

it("loads the complete geometry catalog including Cyrillic route identifiers", async () => {
  const geometries = await Promise.all(
    catalog.routes.map((r) => getRouteGeometry(r.id)),
  );
  expect(geometries).toHaveLength(15);
  for (const [i, response] of geometries.entries()) {
    expect(response.status).toBe(200);
    if (response.status === 200) {
      expect(response.data.properties.route_id).toBe(catalog.routes[i].id);
      expect(response.data.geometry.coordinates).toEqual(
        catalog.routes[i].coordinates,
      );
    }
  }
});
