import { useQuery } from "@tanstack/react-query";
import { config } from "../shared/config/env";
import { readApiJson } from "../shared/api/json";

export interface EvaluatedForecast {
  vehicleId: string;
  routeId: string;
  targetStopId: string;
  stopName: string;
  issuedAt: string;
  plannedAt: string;
  horizonSec: number;
  predictedDelaySec: number;
  actualDelaySec: number | null;
  absoluteErrorSec: number | null;
  actualArrivalAt: string | null;
  observedAt: string | null;
  status: "observed" | "pending" | "awaiting_observation";
  modelVersion: string;
  outcomeSource: string | null;
}
export interface ForecastEvaluation {
  asOf: string;
  namespace: string;
  retentionLimit: number;
  returned: number;
  scope: string;
  summary: { total: number; observed: number; pending: number; awaitingObservation: number; maeSec: number | null; biasSec: number | null };
  items: EvaluatedForecast[];
}
export function pairedForecasts(report: ForecastEvaluation) {
  return report.items.filter(row => row.status === "observed" && row.actualDelaySec !== null)
    .slice(0, 60).sort((a, b) => a.plannedAt.localeCompare(b.plannedAt) || a.vehicleId.localeCompare(b.vehicleId));
}
export function useForecastEvaluation(routeIds: string[]) {
  const ids = [...routeIds].sort();
  return useQuery({
    queryKey: ["analytics", "forecast-evaluation", ids],
    queryFn: async (): Promise<ForecastEvaluation> => {
      const params = new URLSearchParams(ids.map(id => ["route_id", id]));
      const response = await fetch(`${config.apiUrl}/analytics/forecast-evaluation?${params}`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("Журнал прогнозов временно недоступен");
      return await readApiJson(response) as ForecastEvaluation;
    },
    refetchInterval: 5000,
  });
}
