export type RiskLevel = "normal" | "elevated" | "high" | "critical";
export interface Stop {
  id: string;
  name: string;
  sequence: number;
  position: { lat: number; lon: number };
}
export interface Route {
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
export interface Vehicle {
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
  nextStop: Stop;
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
}
export interface Summary {
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
