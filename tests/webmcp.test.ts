import { it, expect } from "vitest";
import { registerTransitTools } from "../src/app/webmcp";
import { keys, queryClient } from "../src/entities/queries";
import { mapRoute } from "../src/entities/adapters";
import { scenarioSnapshot } from "../src/mocks/scenario";
import { useUi } from "../src/app/store";
it("registers page tools, validates inputs and uses the same selection store", async () => {
  const tools: Parameters<
    Parameters<typeof registerTransitTools>[0] extends infer T
      ? NonNullable<T>["registerTool"]
      : never
  >[0][] = [];
  let signal: AbortSignal | undefined;
  const close = registerTransitTools({
    registerTool: (tool, options) => {
      tools.push(tool);
      signal = options.signal;
    },
  });
  expect(tools.map((t) => t.name)).toEqual([
    "select_transit_route",
    "set_forecast_horizon",
  ]);
  queryClient.setQueryData(
    keys.routes,
    scenarioSnapshot(30).routes.map(mapRoute),
  );
  await tools[0].execute({ route_id: "м3" });
  expect(useUi.getState().selectedRouteId).toBe("м3");
  await expect(
    tools[0].execute({ route_id: "does-not-exist" }),
  ).rejects.toThrow("Route not found");
  await tools[1].execute({ minutes: 15 });
  expect(useUi.getState().forecastOffsetMin).toBe(15);
  await expect(tools[1].execute({ minutes: 99 })).rejects.toThrow();
  expect(useUi.getState().forecastOffsetMin).toBe(15);
  close();
  expect(signal?.aborted).toBe(true);
  queryClient.clear();
  useUi.getState().clear();
  useUi.getState().set({ forecastOffsetMin: 0 });
});
