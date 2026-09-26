import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError } from "./dispatch-service";
import type { Route, Vehicle } from "../src/entities/models";

export type DriverMessageKind = "message" | "speed" | "dwell";
export interface DriverMessage {
  id: string;
  routeId: string;
  vehicleId: string;
  kind: DriverMessageKind;
  text: string;
  speedKmh: number | null;
  dwellSec: number | null;
  dwellStops: number | null;
  stopId: string | null;
  createdAt: string;
  /** Accepted by the test dispatch inbox; driver delivery is a separate integration. */
  status: "sent_test" | "draft";
}

/** Durable test dispatch inbox. No driver gateway is connected to this endpoint. */
export class DriverOutbox {
  private items: DriverMessage[];
  constructor(private readonly path?: string) {
    this.items = path && existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8")) as DriverMessage[]
      : [];
    if (!Array.isArray(this.items)) throw new Error("Invalid driver outbox");
  }
  list(routeId?: string) {
    return this.items.filter((item) => !routeId || item.routeId === routeId).slice(0, 50);
  }
  save(input: Record<string, unknown>, route: Route, vehicle: Vehicle) {
    const kind = input.kind;
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!(["message", "speed", "dwell"] as unknown[]).includes(kind))
      throw new ApiError(422, "Неизвестный тип сообщения водителю.");
    if (!text || text.length > 500)
      throw new ApiError(422, "Текст должен содержать от 1 до 500 символов.");
    if (vehicle.routeId !== route.id)
      throw new ApiError(422, "Автобус не принадлежит маршруту.");
    const speedKmh = kind === "speed" ? Number(input.speedKmh) : null;
    const dwellSec = kind === "dwell" ? Number(input.dwellSec) : null;
    const dwellStops = kind === "dwell" ? Number(input.dwellStops ?? 1) : null;
    const stopId = kind === "dwell" && typeof input.stopId === "string" ? input.stopId : null;
    if (kind === "speed" && (!Number.isInteger(speedKmh) || speedKmh! < 5 || speedKmh! > 60))
      throw new ApiError(422, "Укажите скорость от 5 до 60 км/ч.");
    if (kind === "dwell" && (!Number.isInteger(dwellSec) || dwellSec! < 10 || dwellSec! > 300 || !route.stops.some((s) => s.id === stopId)))
      throw new ApiError(422, "Укажите остановку и стоянку от 10 до 300 секунд.");
    if (kind === "dwell" && (!Number.isInteger(dwellStops) || dwellStops! < 1 || dwellStops! > 5))
      throw new ApiError(422, "Укажите от одной до пяти следующих остановок.");
    if (kind === "dwell" && dwellStops! > route.stops.length - route.stops.findIndex((s) => s.id === stopId))
      throw new ApiError(422, "На маршруте нет столько остановок после выбранной.");
    const item: DriverMessage = {
      id: randomUUID(), routeId: route.id, vehicleId: vehicle.id,
      kind: kind as DriverMessageKind, text,
      speedKmh, dwellSec, dwellStops, stopId,
      createdAt: new Date().toISOString(), status: "sent_test",
    };
    const next = [item, ...this.items].slice(0, 500);
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(`${this.path}.tmp`, JSON.stringify(next), { mode: 0o600 });
      renameSync(`${this.path}.tmp`, this.path);
    }
    this.items = next;
    return item;
  }
}
