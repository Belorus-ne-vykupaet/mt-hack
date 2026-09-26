export interface DailyReportMetrics {
  vehiclesObserved: number;
  vehiclesWithForecast: number;
  routesObserved: number;
  peakDelayedVehicles: number;
  meanPredictedDelaySec: number | null;
  peakPredictedDelaySec: number | null;
}

export interface DailyReport {
  date: string;
  archive: boolean;
  firstAsOf: string;
  lastAsOf: string;
  samples: number;
  metrics: DailyReportMetrics;
  source: "rules" | "gigachat";
  model: string | null;
  generatedAt: string;
  basedOnSamples: number;
  needsRefresh: boolean;
  summary: string;
  highlights: string[];
  coverageNote: string;
}

export interface DailyReportList {
  items: DailyReport[];
  modelConfigured: boolean;
  model: string;
}
