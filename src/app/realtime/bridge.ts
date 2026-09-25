import { notifyManager } from "@tanstack/react-query";
import { queryClient, keys, resync } from "../../entities/queries";
import {
  mapSegment,
  mapRoute,
  mapVehicle,
  mapSummary,
  mapPoint,
  mapAlert,
} from "../../entities/adapters";
import type { Route, Vehicle, Alert } from "../../entities/models";
import type {
  RouteDto,
  VehicleDto,
  NetworkSummaryDto,
  DelayPointDto,
  AlertDto,
  ForecastDto,
} from "../../shared/api/generated/models";
import type { StreamEvent } from "./client";
import { useConnection } from "../store";
import { config } from "../../shared/config/env";
const fields: Record<string, string> = {
  forecast_horizon_sec: "forecastHorizonSec",
  forecast_target_time: "forecastTargetTime",
  forecast_model: "forecastModel",
  route_id: "routeId",
  vehicle_id: "vehicleId",
  current_delay_sec: "currentDelaySec",
  predicted_delay_sec: "predictedDelaySec",
  risk_probability: "riskProbability",
  risk_level: "riskLevel",
  speed_kmh: "speedKmh",
  next_stop: "nextStop",
  updated_at: "updatedAt",
  created_at: "createdAt",
  vehicle_count: "activeVehicleCount",
  transport_type: "transportType",
};
export const domainPatch = (payload: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(payload).map(([k, v]) => [fields[k] || k, v]),
  );
export function patchItems<T extends { id: string }>(
  old: T[] | undefined,
  patch: Partial<T> & { id: string },
  create?: () => T,
) {
  const exists = old?.some((x) => x.id === patch.id);
  return exists
    ? old!.map((x) => (x.id === patch.id ? { ...x, ...patch } : x))
    : create
      ? [...(old || []), create()]
      : old;
}
export function applyEvents(events: StreamEvent[]) {
  notifyManager.batch(() =>
    events.forEach((e) => {
      const p = e.payload;
      switch (e.type) {
        case "route.updated":
          queryClient.setQueryData<Route[]>(keys.routes, (old) =>
            patchItems(
              old,
              domainPatch(p) as Partial<Route> & { id: string },
              "number" in p && "stops" in p
                ? () => mapRoute(p as unknown as RouteDto)
                : undefined,
            ),
          );
          break;
        case "route.removed":
          queryClient.setQueryData<Route[]>(keys.routes, (old) =>
            old?.filter((r) => r.id !== p.id),
          );
          break;
        case "vehicle.updated":
          queryClient.setQueryData<Vehicle[]>(keys.vehicles, (old) =>
            patchItems(
              old,
              domainPatch(p) as Partial<Vehicle> & { id: string },
              "route_id" in p && "next_stop" in p
                ? () => mapVehicle(p as unknown as VehicleDto)
                : undefined,
            ),
          );
          break;
        case "vehicle.removed":
          queryClient.setQueryData<Vehicle[]>(keys.vehicles, (old) =>
            old?.filter((v) => v.id !== p.id),
          );
          break;
        case "alert.created":
        case "alert.updated":
          queryClient.setQueryData<Alert[]>(keys.alerts, (old) =>
            patchItems(
              old,
              domainPatch(p) as Partial<Alert> & { id: string },
              "title" in p
                ? () => mapAlert(p as unknown as AlertDto)
                : undefined,
            ),
          );
          break;
        case "alert.resolved":
          queryClient.setQueryData<Alert[]>(keys.alerts, (old) =>
            old?.filter((a) => a.id !== p.id),
          );
          break;
        case "network.updated":
          queryClient.setQueryData(
            keys.summary,
            mapSummary(p as unknown as NetworkSummaryDto),
          );
          break;
        case "forecast.updated": {
          const f = p as unknown as ForecastDto;
          if (f.segments)
            queryClient.setQueryData(keys.segments, f.segments.map(mapSegment));
          f.routes?.forEach((r) =>
            queryClient.setQueryData<Route[]>(keys.routes, (old) =>
              patchItems(
                old,
                domainPatch(
                  r as unknown as Record<string, unknown>,
                ) as Partial<Route> & { id: string },
              ),
            ),
          );
          f.vehicles?.forEach((v) =>
            queryClient.setQueryData<Vehicle[]>(keys.vehicles, (old) =>
              patchItems(
                old,
                domainPatch(
                  v as unknown as Record<string, unknown>,
                ) as Partial<Vehicle> & { id: string },
              ),
            ),
          );
          break;
        }
        case "alerts.snapshot":
          queryClient.setQueryData(
            keys.alerts,
            (p.items as AlertDto[]).map(mapAlert),
          );
          break;
        case "analytics.snapshot":
          queryClient.setQueryData(
            keys.series,
            (p.points as DelayPointDto[]).map(mapPoint),
          );
          break;
        case "demo.alerts.snapshot":
          if (config.dataSource === "mock")
            queryClient.setQueryData(
              keys.alerts,
              (p.items as AlertDto[]).map(mapAlert),
            );
          break;
        case "demo.series.snapshot":
          if (config.dataSource === "mock")
            queryClient.setQueryData(
              keys.series,
              (p.points as DelayPointDto[]).map(mapPoint),
            );
          break;
        default:
          break;
      }
    }),
  );
}
export class StreamBridge {
  lastSequence: number | null = null;
  lastMessage = Date.now();
  private queue: StreamEvent[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private syncing = false;
  private closed = false;
  private reload: () => Promise<unknown>;
  constructor(reload: () => Promise<unknown> = resync) {
    this.reload = reload;
  }
  consume = (e: StreamEvent) => {
    if (this.closed) return;
    this.lastMessage = Date.now();
    if (e.version !== 1) {
      void this.sync();
      return;
    }
    if (e.type === "system.hello") {
      this.lastSequence = e.sequence;
      void this.sync();
      return;
    }
    if (this.lastSequence !== null && e.sequence <= this.lastSequence) return;
    if (this.lastSequence !== null && e.sequence !== this.lastSequence + 1) {
      this.lastSequence = e.sequence;
      void this.sync();
      return;
    }
    this.lastSequence = e.sequence;
    if (this.syncing) return;
    useConnection.getState().set("connected");
    this.queue.push(e);
    if (!this.timer)
      this.timer = setTimeout(() => {
        const batch = this.queue;
        this.queue = [];
        this.timer = undefined;
        applyEvents(batch);
      }, 100);
  };
  async sync() {
    if (this.syncing || this.closed) return;
    this.syncing = true;
    this.queue = [];
    useConnection.getState().set("stale");
    try {
      await this.reload();
      if (!this.closed) useConnection.getState().set("connected");
    } catch {
      if (!this.closed) useConnection.getState().set("reconnecting");
    } finally {
      this.syncing = false;
    }
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.queue = [];
  }
}
