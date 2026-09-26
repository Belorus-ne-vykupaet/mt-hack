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
  target_time: "targetTime",
  expected_arrival_at: "expectedArrivalAt",
  lead_time_sec: "leadTimeSec",
  event_type: "eventType",
  event_time: "eventTime",
  event_lead_time_sec: "eventLeadTimeSec",
  current_segment_id: "currentSegmentId",
  segment_match_status: "segmentMatchStatus",
  segment_match_reason: "segmentMatchReason",
  lateness_threshold_sec: "latenessThresholdSec",
  current_forecast_horizon_sec: "currentForecastHorizonSec",
  current_event_lead_time_sec: "currentEventLeadTimeSec",
  observed_factor: "observedFactor",
  model_status: "modelStatus",
  forecast_horizon_sec: "forecastHorizonSec",
  forecast_target_time: "forecastTargetTime",
  forecast_model: "forecastModel",
  forecast_status: "forecastStatus",
  telemetry_age_sec: "telemetryAgeSec",
  doors_open: "doorsOpen",
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
export function domainPatch(payload: Record<string, unknown>) {
  const result = Object.fromEntries(
    Object.entries(payload).map(([k, v]) => [fields[k] || k,
      ["current_delay_sec", "predicted_delay_sec", "risk_probability"].includes(k) ? v ?? 0 : v]),
  );
  if ("predicted_delay_sec" in payload) result.hasForecast = payload.predicted_delay_sec !== null;
  if ("current_delay_sec" in payload) result.currentDelayKnown = payload.current_delay_sec !== null;
  if ("status" in payload) result.telemetryStale = payload.status === "stale";
  for (const field of ["forecastHorizonSec", "forecastTargetTime", "forecastModel", "currentSegmentId", "segmentMatchReason", "observedFactor"]) {
    if (result[field] === null) result[field] = undefined;
  }
  return result;
}
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
  const routeChanges: Array<(old: Route[] | undefined) => Route[] | undefined> = [];
  const vehicleChanges: Array<(old: Vehicle[] | undefined) => Vehicle[] | undefined> = [];
  notifyManager.batch(() => {
    events.forEach((e) => {
      const p = e.payload;
      switch (e.type) {
        case "route.updated":
          routeChanges.push((old) =>
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
          routeChanges.push((old) => old?.filter((r) => r.id !== p.id));
          break;
        case "vehicle.updated":
          vehicleChanges.push((old) =>
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
          vehicleChanges.push((old) => old?.filter((v) => v.id !== p.id));
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
            routeChanges.push((old) =>
              patchItems(
                old,
                domainPatch(
                  r as unknown as Record<string, unknown>,
                ) as Partial<Route> & { id: string },
              ),
            ),
          );
          f.vehicles?.forEach((v) =>
            vehicleChanges.push((old) =>
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
    });
    if (routeChanges.length)
      queryClient.setQueryData<Route[]>(keys.routes, (old) =>
        routeChanges.reduce((current, change) => change(current), old),
      );
    if (vehicleChanges.length)
      queryClient.setQueryData<Vehicle[]>(keys.vehicles, (old) =>
        vehicleChanges.reduce((current, change) => change(current), old),
      );
  });
}
export class StreamBridge {
  lastSequence: number | null = null;
  lastMessage = Date.now();
  private queue: StreamEvent[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private syncing = false;
  private closed = false;
  private upstreamStale = false;
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
    if (e.type === "system.heartbeat")
      this.upstreamStale = e.payload.stale === true;
    useConnection.getState().set(this.upstreamStale ? "stale" : "connected");
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
      if (!this.closed)
        useConnection.getState().set(this.upstreamStale ? "stale" : "connected");
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
