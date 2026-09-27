import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const ui = vi.hoisted(() => ({
  rightPanel: "vehicle", selectedVehicleId: "vehicle-1", selectedRouteId: "route-1",
  forecastOffsetMin: 15, selectVehicle: () => {}, selectRoute: () => {}, clear: () => {}, set: () => {},
}));
vi.mock("../src/shared/config/env", () => ({ config: { officialMode: true, dataSource: "api" } }));
vi.mock("../src/app/store", () => ({ useUi: () => ui }));
vi.mock("../src/app/theme", () => ({ useTheme: () => ({ theme: "light", setTheme: () => {} }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => () => {} }));
vi.mock("../src/entities/official-model-status", () => ({
  useOfficialModelStatus: () => ({ data: { mode: "official-ndtp", status: "connected" } }),
  modelDisplayName: () => "Предсказание модели",
}));

import { mapAlert, mapRoute, mapSegment, mapVehicle } from "../src/entities/adapters";
import { riskAt } from "../src/entities/forecast";
import { buildStopColumns } from "../src/entities/map-columns";
import { domainPatch } from "../src/app/realtime/bridge";
import { DetailsPanel } from "../src/widgets/DetailsPanel";
import { AlertsPanel } from "../src/widgets/AlertsPanel";
import type { AlertDto, SegmentDto, VehicleDto, RouteDto } from "../src/shared/api/generated/models";

const busDto: VehicleDto = {
  id: "vehicle-1", route_id: "route-1", bearing_deg: 90, position: { lat: 55.75, lon: 37.6 },
  speed_kmh: 12, current_delay_sec: 10, predicted_delay_sec: 102, risk_probability: 0.71,
  risk_level: "elevated", status: "active", next_stop: { id: "stop-target", name: "Цель", sequence: 3, position: { lat: 55.76, lon: 37.61 } },
  updated_at: "2026-01-06T12:00:00Z", forecast_horizon_sec: 720, forecast_target_time: "2026-01-06T12:12:00Z",
  current_segment_id: "segment-1", segment_match_status: "matched",
  suspected_cause: "замедленное движение на подходе",
};
const routeDto: RouteDto = { id: "route-1", number: "1", name: "Улица — Площадь", transport_type: "bus",
  current_delay_sec: 10, predicted_delay_sec: 102, risk_probability: 0.71, risk_level: "elevated", vehicle_count: 1,
  stops: [busDto.next_stop!],
};
const segmentDto: SegmentDto = { id: "segment-1", route_id: "route-1", name: "Улица → Площадь",
  geometry: { type: "LineString", coordinates: [[37.6, 55.75], [37.61, 55.76]] },
  current_delay_sec: 10, predicted_delay_sec: 102, risk_probability: 0.71, risk_level: "elevated",
  mean_speed_kmh: 12.5, dwell_sec: 90, is_current: true, risk_scope: "vehicle_target_stop",
};
const alertDto: AlertDto = { id: "warning-1", severity: "warning", type: "delay-risk", title: "Риск", description: "test",
  route_id: "route-1", vehicle_id: "vehicle-1", risk_probability: 0.71, predicted_delay_sec: 102,
  created_at: "2026-01-06T12:00:00Z", target_time: "2026-01-06T12:12:00Z", expected_arrival_at: "2026-01-06T12:13:42Z",
  lead_time_sec: 720, event_type: "late_threshold", event_time: "2026-01-06T12:14:00Z", event_lead_time_sec: 840,
  forecast_horizon_sec: 720, observed_factor: "Низкая средняя скорость: 12,5 км/ч", model_status: "ready",
  suspected_cause: "замедленное движение на подходе",
};
beforeEach(() => { ui.rightPanel = "vehicle"; });

it("preserves a probability-driven warning across vehicle, route, segment and 3D target column", () => {
  const bus = mapVehicle(busDto), route = mapRoute(routeDto), segment = mapSegment(segmentDto);
  expect(riskAt(bus, 15)).toBe("elevated"); // 71% risk, expected delay only 102 seconds
  expect(riskAt(route, 15)).toBe("elevated");
  expect(riskAt(segment, 15)).toBe("elevated");
  const columns = buildStopColumns([segment], [route], 15, [bus]);
  expect(columns).toHaveLength(1);
  expect(columns[0].stop.id).toBe("stop-target");
  expect(columns[0].riskLevel).toBe("elevated");
  expect(riskAt(bus, 0)).toBe("normal");
  expect(riskAt({ ...bus, currentDelaySec: 120 }, 0)).toBe("normal");
  expect(riskAt({ ...bus, currentDelaySec: 121 }, 0)).toBe("elevated");
  expect(riskAt({ ...bus, currentDelaySec: 300 }, 0)).toBe("high");
});

it("keeps absent or stale predictions unknown and does not invent segment forecast columns", () => {
  const bus = mapVehicle({ ...busDto, status: "stale" });
  expect(riskAt(bus, 15)).toBe("unknown");
  expect(riskAt(bus, 0)).toBe("unknown");
  const missing = mapSegment({ ...segmentDto, current_delay_sec: null, predicted_delay_sec: null, risk_probability: null, risk_level: "unknown" });
  expect(riskAt(missing, 15)).toBe("unknown");
  expect(riskAt(missing, 0)).toBe("unknown");
  expect(buildStopColumns([mapSegment(segmentDto)], [mapRoute(routeDto)], 15)).toEqual([]);
});

it("renders incident evidence and separates the event lead time from the scheduled target", () => {
  const alerts = [mapAlert(alertDto)];
  const card = renderToStaticMarkup(createElement(DetailsPanel, {
    routes: [mapRoute(routeDto)], vehicles: [mapVehicle(busDto)], segments: [mapSegment(segmentDto)], alerts,
  }));
  expect(card).toContain("Низкая средняя скорость: 12,5 км/ч");
  expect(card).toContain("Возможная причина");
  expect(card).toContain("замедленное движение на подходе");
  expect(card).toContain("Улица → Площадь");
  expect(card).toContain("12.5 км/ч");
  expect(card).toContain("1.5 мин");
  expect(card).toContain("Первый сигнал за 14.0 мин до порога");
  expect(card).toContain("до плановой остановки: 12.0 мин");
  expect(card).not.toContain("после подключения модели");
  const queue = renderToStaticMarkup(createElement(AlertsPanel, { alerts, segments: [mapSegment(segmentDto)] }));
  expect(queue).toContain("Риск опоздания &gt;2 мин");
  expect(queue).toContain("Порог опоздания &gt;2 мин: 12:14");
  expect(queue).toContain("План 12:12");
  expect(queue).toContain("Первый сигнал за 14.0 мин до порога");
  expect(queue).toContain("Участок: Улица → Площадь");
  expect(queue).toContain("Возможная причина: замедленное движение на подходе");
});

it("shows truthful unavailable segment and factor states instead of zero-of-zero or connect-model copy", () => {
  ui.rightPanel = "route";
  const card = renderToStaticMarkup(createElement(DetailsPanel, {
    routes: [mapRoute(routeDto)], vehicles: [mapVehicle(busDto)], segments: [], alerts: [],
  }));
  expect(card).toContain("Участок не определён");
  expect(card).toContain("недостаточно признаков для гипотезы");
  expect(card).not.toContain("0 из 0");
  expect(card).not.toContain("после подключения модели");
});

it("updates and clears incident/segment metadata through the real-time domain mapper", () => {
  expect(domainPatch({ event_type: "late_threshold", event_lead_time_sec: 840,
    current_event_lead_time_sec: 780, forecast_horizon_sec: 720, current_forecast_horizon_sec: 660,
    target_time: alertDto.target_time, observed_factor: "Новый фактор", current_segment_id: "segment-2",
  })).toMatchObject({ eventType: "late_threshold", eventLeadTimeSec: 840,
    currentEventLeadTimeSec: 780, forecastHorizonSec: 720, currentForecastHorizonSec: 660,
    targetTime: alertDto.target_time, observedFactor: "Новый фактор", currentSegmentId: "segment-2",
  });
  expect(domainPatch({ current_segment_id: null, observed_factor: null })).toEqual({ currentSegmentId: undefined, observedFactor: undefined });
});


it("shows a route's vehicle evidence before the warning publication window opens", () => {
  ui.rightPanel = "route";
  const card = renderToStaticMarkup(createElement(DetailsPanel, {
    routes: [mapRoute(routeDto)],
    vehicles: [mapVehicle({ ...busDto, observed_factor: "Скорость на участке 12,5 км/ч" })],
    segments: [mapSegment(segmentDto)], alerts: [],
  }));
  expect(card).toContain("Скорость на участке 12,5 км/ч");
  expect(card).not.toContain("Недостаточно данных");
});
