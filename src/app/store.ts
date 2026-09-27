import { create } from "zustand";
import type { RiskLevel } from "../entities/models";
export type Panel =
  | "alerts"
  | "route"
  | "vehicle"
  | "routes"
  | "vehicles"
  | "stops"
  | "settings";
interface Ui {
  selectedRouteId: string | null;
  selectedVehicleId: string | null;
  selectedStopId: string | null;
  rightPanel: Panel;
  forecastOffsetMin: number;
  mapMode: "overview" | "flow";
  routeFilters: string[];
  riskFilter: RiskLevel | "all";
  search: string;
  vehiclesVisible: boolean;
  routesVisible: boolean;
  layersOpen: boolean;
  focusVersion: number;
  selectRoute: (id: string) => void;
  selectVehicle: (id: string, routeId: string) => void;
  selectStop: (id: string, routeId: string) => void;
  set: (patch: Partial<Ui>) => void;
  clear: () => void;
}
export const useUi = create<Ui>((set) => ({
  selectedRouteId: null,
  selectedVehicleId: null,
  selectedStopId: null,
  rightPanel: "alerts",
  forecastOffsetMin: 0,
  mapMode: "overview",
  routeFilters: [],
  riskFilter: "all",
  search: "",
  vehiclesVisible: true,
  routesVisible: true,
  layersOpen: false,
  focusVersion: 0,
  selectRoute: (id) =>
    set((s) => ({
      selectedRouteId: id,
      routeFilters:
        s.routeFilters.length && !s.routeFilters.includes(id)
          ? [...s.routeFilters, id]
          : s.routeFilters,
      selectedVehicleId: null,
      selectedStopId: null,
      rightPanel: "route",
      search: "",
      focusVersion: s.focusVersion + 1,
    })),
  selectVehicle: (id, routeId) =>
    set((s) => ({
      selectedRouteId: routeId,
      routeFilters:
        s.routeFilters.length && !s.routeFilters.includes(routeId)
          ? [...s.routeFilters, routeId]
          : s.routeFilters,
      selectedVehicleId: id,
      selectedStopId: null,
      rightPanel: "vehicle",
      search: "",
      focusVersion: s.focusVersion + 1,
    })),
  selectStop: (id, routeId) =>
    set((s) => ({
      selectedRouteId: routeId,
      routeFilters:
        s.routeFilters.length && !s.routeFilters.includes(routeId)
          ? [...s.routeFilters, routeId]
          : s.routeFilters,
      selectedStopId: id,
      selectedVehicleId: null,
      rightPanel: "route",
      search: "",
      focusVersion: s.focusVersion + 1,
    })),
  set: (patch) => set(patch),
  clear: () =>
    set({
      selectedRouteId: null,
      selectedVehicleId: null,
      selectedStopId: null,
      rightPanel: "alerts",
    }),
}));
export type Connection =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "stale"
  | "offline";
export const useConnection = create<{
  status: Connection;
  lastUpdate: number;
  set: (status: Connection) => void;
}>((set) => ({
  status: "connecting",
  lastUpdate: Date.now(),
  set: (status) =>
    set((s) => ({
      status,
      lastUpdate: status === "connected" ? Date.now() : s.lastUpdate,
    })),
}));
