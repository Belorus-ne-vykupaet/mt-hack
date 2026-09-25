import { config } from "../shared/config/env";
import { QueryClient, useQuery } from "@tanstack/react-query";
import {
  getForecast,
  getRoutes,
  getVehicles,
  getAlerts,
  getNetworkSummary,
  getDelaySeries,
  getRouteGeometry,
} from "../shared/api/generated/endpoints";
import {
  mapSegment,
  mapRoute,
  mapVehicle,
  mapAlert,
  mapSummary,
  mapPoint,
  mapGeometry,
} from "./adapters";
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10000, retry: 1, refetchOnWindowFocus: false },
  },
});
export const keys = {
  segments: ["network", "segments"],
  routes: ["routes"],
  vehicles: ["vehicles"],
  alerts: ["alerts"],
  summary: ["network", "summary"],
  series: ["analytics", "series"],
  geometry: ["routes", "geometry"],
};
export function unwrap<T>(r: { status: number; data: T }): T {
  if (r.status !== 200) throw new Error("Не удалось загрузить данные");
  return r.data;
}
export const loaders = {
  segments: async () => {
    const r = await getForecast();
    if (r.status !== 200) throw new Error("Участки недоступны");
    return r.data.segments.map(mapSegment);
  },
  routes: async () => {
    const r = await getRoutes();
    if (r.status !== 200) throw new Error("Ошибка загрузки маршрутов");
    return r.data.items.map(mapRoute);
  },
  vehicles: async () => {
    const r = await getVehicles();
    if (r.status !== 200) throw new Error("Ошибка загрузки транспорта");
    return r.data.items.map(mapVehicle);
  },
  alerts: async () => {
    const r = await getAlerts();
    if (r.status !== 200) throw new Error("Ошибка загрузки событий");
    return r.data.items.map(mapAlert);
  },
  summary: async () => {
    const r = await getNetworkSummary();
    if (r.status !== 200) throw new Error("Ошибка загрузки сети");
    return mapSummary(r.data);
  },
  series: async () => {
    const r = await getDelaySeries();
    if (r.status !== 200) throw new Error("Ошибка загрузки аналитики");
    return r.data.points.map(mapPoint);
  },
};
export function useNetwork() {
  return {
    segments: useQuery({ queryKey: keys.segments, queryFn: loaders.segments }),
    routes: useQuery({ queryKey: keys.routes, queryFn: loaders.routes }),
    vehicles: useQuery({ queryKey: keys.vehicles, queryFn: loaders.vehicles }),
    alerts: useQuery({ queryKey: keys.alerts, queryFn: loaders.alerts }),
    summary: useQuery({ queryKey: keys.summary, queryFn: loaders.summary }),
    series: useQuery({ queryKey: keys.series, queryFn: loaders.series }),
  };
}
export function useGeometries(ids: string[]) {
  return useQuery({
    queryKey: [...keys.geometry, ids.join(",")],
    queryFn: async () => {
      if (config.officialMode) {
        // Road-aligned archive reference is a separate, immutable map layer.
        // It is fetched once; live vehicle positions and predictions still poll.
        const response = await fetch("/data/official-road-routes.json");
        if (!response.ok) throw new Error("Дорожная схема недоступна");
        const reference = (await response.json()) as {
          routes: { routeId: string; paths: number[][][] }[];
        };
        const wanted = new Set(ids);
        return reference.routes
          .filter((item) => wanted.has(item.routeId))
          .flatMap((item) =>
            item.paths.map((coordinates) => ({ routeId: item.routeId, coordinates })),
          );
      }
      return Promise.all(
        ids.map(async (id) => {
          const r = await getRouteGeometry(id);
          if (r.status !== 200) throw new Error("Геометрия недоступна");
          return mapGeometry(r.data);
        }),
      );
    },
    enabled: ids.length > 0,
    staleTime: Infinity,
  });
}
export const resync = () =>
  Promise.all(
    Object.entries(loaders).map(([name, queryFn]) =>
      queryClient.fetchQuery({
        queryKey: keys[name as keyof typeof loaders],
        queryFn: queryFn as () => Promise<unknown>,
        staleTime: 0,
      }),
    ),
  );
