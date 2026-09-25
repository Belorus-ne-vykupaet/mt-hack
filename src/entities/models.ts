export type RiskLevel = "normal" | "elevated" | "high" | "critical" | "unknown";
export interface PredictionAvailability {
  hasForecast?: boolean;
  currentDelayKnown?: boolean;
  forecastStatus?: "ready" | "fallback" | "no_schedule" | "no_target" | "stale_gps" | "unavailable";
}
export interface Stop {
  id: string;
  name: string;
  sequence: number;
  position: { lat: number; lon: number };
}
export interface Route extends PredictionAvailability {
  id: string;
  number: string;
  name: string;
  transportType: string;
  currentDelaySec: number;
  predictedDelaySec: number;
  riskProbability: number;
  riskLevel: RiskLevel;
  activeVehicleCount: number;
  stops: Stop[];
}
export interface Vehicle extends PredictionAvailability {
  bearingDeg?: number;
  telemetryAgeSec?: number;
  telemetryStale?: boolean;
  forecastHorizonSec?: number;
  forecastTargetTime?: string;
  forecastModel?: string;
  id: string;
  routeId: string;
  position: { lat: number; lon: number };
  speedKmh: number;
  currentDelaySec: number;
  predictedDelaySec: number;
  riskProbability: number;
  riskLevel: RiskLevel;
  nextStop: Stop | null;
  updatedAt: string;
}
export interface Alert {
  id: string;
  severity: "info" | "warning" | "high" | "critical";
  title: string;
  description: string;
  routeId: string;
  vehicleId: string;
  riskProbability: number;
  predictedDelaySec: number;
  createdAt: string;
  targetTime?: string;
  expectedArrivalAt?: string;
  leadTimeSec?: number;
  observedFactor?: string;
  modelStatus?: "ready" | "fallback";
}
export interface Summary {
  vehiclesLocated?: number;
  vehiclesStale?: number;
  vehiclesPredicted?: number;
  vehiclesAssessed?: number;
  vehiclesWithoutPosition?: number;
  vehiclesTotal: number;
  vehiclesActive: number;
  routesActive: number;
  onTimePercent: number;
  atRiskPercent: number;
  delayedPercent: number;
  averageDelaySec: number;
  averagePredictedDelaySec: number;
  timestamp: string;
}
export interface DelayPoint {
  timestamp: string;
  actualDelaySec: number | null;
  predictedDelaySec: number | null;
}
export interface Geometry {
  routeId: string;
  coordinates: number[][];
  validFrom?: string;
  validUntil?: string;
}

export interface Segment {
  id: string;
  routeId: string;
  coordinates: number[][];
  currentDelaySec: number;
  predictedDelaySec: number;
  riskProbability: number;
  riskLevel: RiskLevel;
}
