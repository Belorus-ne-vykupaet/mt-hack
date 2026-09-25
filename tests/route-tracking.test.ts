import { beforeEach, expect, it } from "vitest";
import { useUi } from "../src/app/store";
beforeEach(() => {
  useUi.getState().clear();
  useUi.getState().set({ routeFilters: [] });
});
it("keeps several tracked routes when inspecting a route, vehicle or stop", () => {
  useUi.getState().set({ routeFilters: ["м3", "м5"] });
  useUi.getState().selectRoute("м3");
  expect(useUi.getState().routeFilters).toEqual(["м3", "м5"]);
  useUi.getState().selectVehicle("vehicle-742", "м3");
  expect(useUi.getState().routeFilters).toEqual(["м3", "м5"]);
  useUi.getState().selectStop("stop-1", "м5");
  expect(useUi.getState().routeFilters).toEqual(["м3", "м5"]);
});
it("includes an explicitly opened route so its card never points to a hidden route", () => {
  useUi.getState().set({ routeFilters: ["м3"] });
  useUi.getState().selectRoute("м5");
  expect(useUi.getState().routeFilters).toEqual(["м3", "м5"]);
  useUi.getState().set({ routeFilters: [] });
  useUi.getState().selectRoute("м3");
  expect(useUi.getState().routeFilters).toEqual([]);
});
