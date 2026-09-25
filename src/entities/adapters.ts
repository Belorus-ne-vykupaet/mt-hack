import type {
  RouteDto,
  VehicleDto,
  AlertDto,
  NetworkSummaryDto,
  DelayPointDto,
  RouteGeometryDto,
} from "../shared/api/generated/models";
import type {
  Route,
  Vehicle,
  Alert,
  Summary,
  DelayPoint,
  Geometry,
} from "./models";
export const mapRoute = (d: RouteDto): Route => ({
  id: d.id,
  number: d.number,
  name: d.name,
  transportType: d.transport_type,
  currentDelaySec: d.current_delay_sec,
  predictedDelaySec: d.predicted_delay_sec,
  riskProbability: d.risk_probability,
  riskLevel: d.risk_level,
  activeVehicleCount: d.vehicle_count,
  stops: d.stops,
});
export const mapVehicle = (d: VehicleDto): Vehicle => ({
  forecastHorizonSec: d.forecast_horizon_sec,
  forecastTargetTime: d.forecast_target_time,
  forecastModel: d.forecast_model,
  id: d.id,
  routeId: d.route_id,
  position: d.position,
  speedKmh: d.speed_kmh,
  currentDelaySec: d.current_delay_sec,
  predictedDelaySec: d.predicted_delay_sec,
  riskProbability: d.risk_probability,
  riskLevel: d.risk_level,
  nextStop: d.next_stop,
  updatedAt: d.updated_at,
});
export const mapAlert = (d: AlertDto): Alert => ({
  id: d.id,
  severity: d.severity,
  title: d.title,
  description: d.description,
  routeId: d.route_id,
  vehicleId: d.vehicle_id,
  riskProbability: d.risk_probability,
  predictedDelaySec: d.predicted_delay_sec,
  createdAt: d.created_at,
});
export const mapSummary = (d: NetworkSummaryDto): Summary => ({
  vehiclesTotal: d.vehicles_total,
  vehiclesActive: d.vehicles_active,
  routesActive: d.routes_active,
  onTimePercent: d.on_time_percent,
  atRiskPercent: d.at_risk_percent,
  delayedPercent: d.delayed_percent,
  averageDelaySec: d.average_delay_sec,
  averagePredictedDelaySec: d.average_predicted_delay_sec,
  timestamp: d.timestamp,
});
export const mapPoint = (d: DelayPointDto): DelayPoint => ({
  timestamp: d.timestamp,
  actualDelaySec: d.actual_delay_sec,
  predictedDelaySec: d.predicted_delay_sec,
});
export const mapGeometry = (d: RouteGeometryDto): Geometry => ({
  routeId: d.properties.route_id,
  coordinates: d.geometry.coordinates,
});

export const mapSegment = (
  d: import("../shared/api/generated/models").SegmentDto,
): import("./models").Segment => ({
  id: d.id,
  routeId: d.route_id,
  coordinates: d.geometry.coordinates,
  currentDelaySec: d.current_delay_sec,
  predictedDelaySec: d.predicted_delay_sec,
  riskProbability: d.risk_probability,
  riskLevel: d.risk_level,
});
