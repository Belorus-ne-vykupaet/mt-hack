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
  hasForecast: d.predicted_delay_sec !== null,
  currentDelayKnown: d.current_delay_sec !== null,
  forecastStatus: d.forecast_status,
  id: d.id,
  number: d.number,
  name: d.name,
  transportType: d.transport_type,
  currentDelaySec: d.current_delay_sec ?? 0,
  predictedDelaySec: d.predicted_delay_sec ?? 0,
  riskProbability: d.risk_probability ?? 0,
  riskLevel: d.risk_level,
  activeVehicleCount: d.vehicle_count,
  stops: d.stops,
});
export const mapVehicle = (d: VehicleDto): Vehicle => ({
  bearingDeg: d.bearing_deg,
  forecastHorizonSec: d.forecast_horizon_sec ?? undefined,
  forecastTargetTime: d.forecast_target_time ?? undefined,
  forecastModel: d.forecast_model ?? undefined,
  currentSegmentId: d.current_segment_id ?? undefined,
  segmentMatchStatus: d.segment_match_status,
  segmentMatchReason: d.segment_match_reason ?? undefined,
  observedFactor: d.observed_factor ?? undefined,
  hasForecast: d.predicted_delay_sec !== null,
  currentDelayKnown: d.current_delay_sec !== null,
  forecastStatus: d.forecast_status,
  telemetryAgeSec: d.telemetry_age_sec,
  telemetryStale: d.status === "stale",
  doorsOpen: d.doors_open,
  id: d.id,
  routeId: d.route_id,
  position: d.position,
  speedKmh: d.speed_kmh,
  currentDelaySec: d.current_delay_sec ?? 0,
  predictedDelaySec: d.predicted_delay_sec ?? 0,
  riskProbability: d.risk_probability ?? 0,
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
  targetTime: d.target_time,
  expectedArrivalAt: d.expected_arrival_at,
  leadTimeSec: d.lead_time_sec,
  eventType: d.event_type,
  eventTime: d.event_time,
  eventLeadTimeSec: d.event_lead_time_sec,
  latenessThresholdSec: d.lateness_threshold_sec,
  currentForecastHorizonSec: d.current_forecast_horizon_sec,
  currentEventLeadTimeSec: d.current_event_lead_time_sec,
  forecastHorizonSec: d.forecast_horizon_sec,
  observedFactor: d.observed_factor,
  modelStatus: d.model_status,
});
export const mapSummary = (d: NetworkSummaryDto): Summary => ({
  vehiclesLocated: d.vehicles_located,
  vehiclesStale: d.vehicles_stale,
  vehiclesPredicted: d.vehicles_predicted,
  vehiclesAssessed: d.vehicles_assessed,
  vehiclesWithoutPosition: d.vehicles_without_position,
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

export const expandGeometry = (d: RouteGeometryDto): Geometry[] =>
  d.properties.observed_paths?.length
    ? d.properties.observed_paths.map((coordinates) => ({
        routeId: d.properties.route_id,
        coordinates,
      }))
    : d.geometry.coordinates.length > 1
      ? [mapGeometry(d)]
      : [];

export const mapSegment = (
  d: import("../shared/api/generated/models").SegmentDto,
): import("./models").Segment => ({
  id: d.id,
  routeId: d.route_id,
  coordinates: d.geometry.coordinates,
  name: d.name,
  fromStopId: d.from_stop_id,
  toStopId: d.to_stop_id,
  fromSequence: d.from_sequence,
  toSequence: d.to_sequence,
  meanSpeedKmh: d.mean_speed_kmh,
  dwellSec: d.dwell_sec,
  observedDistanceM: d.observed_distance_m,
  coverageSec: d.coverage_sec,
  observedPaths: d.observed_paths,
  isCurrent: d.is_current,
  matchingMethod: d.matching_method,
  riskScope: d.risk_scope,
  forecastTargetStopId: d.forecast_target_stop_id,
  hasForecast: d.predicted_delay_sec !== null,
  currentDelayKnown: d.current_delay_sec !== null,
  currentDelaySec: d.current_delay_sec ?? 0,
  predictedDelaySec: d.predicted_delay_sec ?? 0,
  riskProbability: d.risk_probability ?? 0,
  riskLevel: d.risk_level,
});
