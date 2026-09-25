import { expect, it } from "vitest";
import { mapVehicle, mapPoint } from "../src/entities/adapters";
import { domainPatch } from "../src/app/realtime/bridge";
import { riskAt } from "../src/entities/forecast";
import { buildStopColumns } from "../src/entities/map-columns";
import type { VehicleDto } from "../src/shared/api/generated/models";
const missing: VehicleDto = {
  id: "vehicle-no-plan", route_id: "duty-no-plan",
  position: {lat:55.75, lon:37.6}, speed_kmh:20, bearing_deg:90,
  current_delay_sec:null, predicted_delay_sec:null, risk_probability:null,
  risk_level:"unknown", status:"active", forecast_status:"no_schedule",
  next_stop:null, updated_at:"2026-01-06T17:50:00Z",
  forecast_horizon_sec:null, forecast_target_time:null, forecast_model:null,
};
it("keeps a bus without a schedule, unknown risk and no invented stop column", () => {
  const bus = mapVehicle(missing);
  expect(bus.id).toBe(missing.id);
  expect(bus.position).toEqual(missing.position);
  expect(bus.hasForecast).toBe(false);
  expect(bus.currentDelayKnown).toBe(false);
  expect(riskAt(bus, 15)).toBe("unknown");
  expect(riskAt(bus, 0)).toBe("unknown");
  expect(buildStopColumns([], [], 15, [bus])).toEqual([]);
});
it("clears an old forecast when a WS update reports GPS loss", () => {
  const previous = {...mapVehicle(missing), hasForecast:true, forecastHorizonSec:720, forecastModel:"catboost", forecastTargetTime:"2026-01-06T18:02:00Z", riskLevel:"high" as const};
  const next = {...previous, ...domainPatch({...missing, status:"stale", forecast_status:"stale_gps", telemetry_age_sec:2400})};
  expect(next.id).toBe(previous.id);
  expect(next.position).toEqual(previous.position);
  expect(next.forecastHorizonSec).toBeUndefined();
  expect(next.forecastTargetTime).toBeUndefined();
  expect(next.forecastModel).toBeUndefined();
  expect(next.hasForecast).toBe(false);
  expect(next.telemetryStale).toBe(true);
  expect(riskAt(next, 15)).toBe("unknown");
});

it("preserves missing prediction points as chart gaps", () => {
  expect(mapPoint({timestamp:"2026-01-06T17:50:00Z", actual_delay_sec:20, predicted_delay_sec:null}).predictedDelaySec).toBeNull();
});
