import { readApiJson } from "./json";
import { useQuery } from "@tanstack/react-query";
import { config } from "../config/env";
import { queryClient } from "../../entities/queries";
import type { DispatchPlan } from "../../entities/dispatch";
import type { DispatchRecommendation } from "../../entities/dispatch-recommendations";
export interface ApiCommand {
  id: string;
  plan: DispatchPlan;
  status: "draft" | "applied_demo" | "cancelled" | "replaced";
  history: { status: string; at: string }[];
}
export interface CommandState {
  revision: number;
  reserve: number;
  commands: ApiCommand[];
}
export interface RecommendationState {
  revision: number;
  generatedAt: string;
  expiresAt: string;
  method: string;
  reserve: number;
  items: DispatchRecommendation[];
}
export interface IntegrationState {
  mode: string;
  network: { status: string; source: string; asOf: string };
  dispatch: { status: string; executor: string; persisted: boolean };
  model: { status: string; configured: boolean; version: string };
  weather: { status: string; source: string };
  traffic: { status: string; source: string };
  authenticated: boolean;
  externalFeaturesUsed: boolean;
}
export class IntegrationError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function integrationRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${config.integrationUrl}${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    signal: options.signal || AbortSignal.timeout(10000),
  });
  let data: unknown;
  try {
    data = await readApiJson(response);
  } catch (e) {
    throw new IntegrationError((e as Error).message, response.status);
  }
  if (!response.ok)
    throw new IntegrationError(
      (data as { error?: { message?: string } } | null)?.error?.message ||
        `API недоступен (${response.status})`,
      response.status,
    );
  return data as T;
}
export const commandKey = ["dispatch-api", "commands"];
export const recommendationKey = ["dispatch-api", "recommendations"];
export function useApiDispatch() {
  const commands = useQuery({
    queryKey: commandKey,
    queryFn: () => integrationRequest<CommandState>("/dispatch/commands"),
    enabled: config.dispatchApi,
    refetchInterval: 5000,
    retry: false,
  });
  const recommendations = useQuery({
    queryKey: recommendationKey,
    queryFn: () =>
      integrationRequest<RecommendationState>("/dispatch/recommendations"),
    enabled: config.dispatchApi,
    refetchInterval: 5000,
    retry: false,
  });
  return { commands, recommendations };
}
export async function refreshApiDispatch() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: commandKey }),
    queryClient.invalidateQueries({ queryKey: recommendationKey }),
  ]);
}
