import type { RouteDto, VehicleDto, StopDto, SegmentDto } from "../shared/api/generated/models";
// Synthetic scenarios always contain a complete numeric prediction.
type Simulated<T> = Omit<T, "current_delay_sec" | "predicted_delay_sec" | "risk_probability" | "risk_level"> & {
  current_delay_sec: number;
  predicted_delay_sec: number;
  risk_probability: number;
  risk_level: "normal" | "elevated" | "high" | "critical";
};
export type DemoRouteDto = Simulated<RouteDto>;
export type DemoVehicleDto = Simulated<VehicleDto> & { next_stop: StopDto };

export type DemoSegmentDto = Simulated<SegmentDto>;
