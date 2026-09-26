import { useQuery } from "@tanstack/react-query";
import { integrationRequest } from "../shared/api/integrations";
import { config } from "../shared/config/env";

export interface OfficialModelStatus {
  mode: string;
  status: string;
  stale?: boolean;
  asOf?: string;
  modelVersion?: string;
  pipelineMs?: number;
  inferenceMs?: number;
  predictedVehicles?: number;
  locatedVehicles?: number;
  freshVehicles?: number;
  staleVehicles?: number;
  totalVehicles?: number;
  scheduledVehicles?: number;
  contextVehicles?: number;
  scheduledWithoutPosition?: number;
  scheduledStale?: number;
  scheduledWithoutTarget?: number;
  metrics?: {
    modelFamily?: string;
    maeSec: number;
    persistenceMaeSec: number;
    trainRows: number;
    testRows: number;
  };
  ndtp?: { frames: number; connections: number };
}

export function useOfficialModelStatus() {
  return useQuery({
    queryKey: ["official-model-status"],
    queryFn: () => integrationRequest<OfficialModelStatus>("/ml/status"),
    enabled: config.officialMode,
    refetchInterval: 5000,
    retry: false,
  });
}

export function modelDisplayName(status?: OfficialModelStatus) {
  const family = status?.metrics?.modelFamily?.replace(/Regressor$/, "");
  return family || status?.modelVersion || "модель";
}

export function activeModel(status?: OfficialModelStatus, isError = false) {
  return status?.status === "connected" && !status.stale && !isError;
}

export function modelHeaderLabel(status?: OfficialModelStatus, isError = false) {
  if (isError || status?.stale) return "ДАННЫЕ УСТАРЕЛИ";
  if (status?.status === "fallback") return "РЕЗЕРВНЫЙ ПРОГНОЗ";
  if (status?.status === "no_targets") return "НЕТ ЦЕЛЕЙ ПРОГНОЗА";
  if (!activeModel(status)) return "ПРОВЕРКА МОДЕЛИ";
  return `${modelDisplayName(status).toUpperCase()} · ${status?.mode === "official-ndtp" ? "NDTP" : "АРХИВ"}`;
}
