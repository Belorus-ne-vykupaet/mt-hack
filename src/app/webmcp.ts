import { useUi } from "./store";
import { keys, queryClient } from "../entities/queries";
import type { Route } from "../entities/models";
interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute: (input: unknown) => Promise<unknown>;
}
interface ModelContext {
  registerTool: (
    tool: Tool,
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
}
const record = (input: unknown) => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Expected an object");
  return input as Record<string, unknown>;
};
export function registerTransitTools(context: ModelContext | undefined) {
  if (!context?.registerTool) return () => {};
  const controller = new AbortController();
  const tools: Tool[] = [
    {
      name: "select_transit_route",
      description:
        "Select an existing route and open its dispatcher details in the current view.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: { route_id: { type: "string" } },
        required: ["route_id"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const p = record(input);
        if (
          Object.keys(p).some((k) => k !== "route_id") ||
          typeof p.route_id !== "string"
        )
          throw new Error("route_id must be a string");
        const route = queryClient
          .getQueryData<Route[]>(keys.routes)
          ?.find((r) => r.id === p.route_id);
        if (!route) throw new Error("Route not found");
        useUi.getState().selectRoute(route.id);
        await Promise.resolve();
        return { selected_route: route.id, panel: "route" };
      },
    },
    {
      name: "set_forecast_horizon",
      description:
        "Set the visible forecast offset between now and 15 minutes.",
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        properties: { minutes: { type: "number", minimum: 0, maximum: 15 } },
        required: ["minutes"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const p = record(input);
        if (
          Object.keys(p).some((k) => k !== "minutes") ||
          typeof p.minutes !== "number" ||
          !Number.isFinite(p.minutes) ||
          p.minutes < 0 ||
          p.minutes > 15
        )
          throw new Error("minutes must be a finite number from 0 to 15");
        useUi.getState().set({ forecastOffsetMin: p.minutes });
        await Promise.resolve();
        return { forecast_offset_minutes: useUi.getState().forecastOffsetMin };
      },
    },
  ];
  tools.forEach((tool) => {
    try {
      void Promise.resolve(
        context.registerTool(tool, { signal: controller.signal }),
      ).catch(() => {});
    } catch {
      /* Optional browser API must not block the dashboard. */
    }
  });
  return () => controller.abort();
}
export function installWebMcp() {
  return registerTransitTools(
    (document as Document & { modelContext?: ModelContext }).modelContext,
  );
}
