import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pairedForecasts, type ForecastEvaluation } from "../src/entities/forecast-evaluation";
import { ForecastEvaluation as EvaluationPanel } from "../src/widgets/ForecastEvaluation";

const state = vi.hoisted(() => ({ data: undefined as ForecastEvaluation | undefined, error: false }));
vi.mock("../src/app/store", () => ({ useUi: (select: (s: { routeFilters: string[] }) => unknown) => select({ routeFilters: [] }) }));
vi.mock("../src/shared/ui/Chart", () => ({ Chart: ({ label }: { label: string }) => createElement("div", { "aria-label": label }) }));
vi.mock("../src/entities/forecast-evaluation", async importOriginal => ({
  ...await importOriginal<typeof import("../src/entities/forecast-evaluation")>(),
  useForecastEvaluation: () => ({ data: state.data, isPending: false, isError: state.error, refetch: vi.fn() }),
}));

const report: ForecastEvaluation = {
  asOf: "2026-01-06T12:20:00Z", namespace: "test", scope: "first", retentionLimit: 20000, returned: 2,
  summary: { total: 2, observed: 1, pending: 0, awaitingObservation: 1, maeSec: 30, biasSec: 30 },
  items: [{ vehicleId: "vehicle-1", routeId: "duty-1", targetStopId: "101", stopName: "Площадь",
    issuedAt: "2026-01-06T12:00:00Z", plannedAt: "2026-01-06T12:12:00Z", horizonSec: 720,
    predictedDelaySec: 150, actualDelaySec: 120, absoluteErrorSec: 30, status: "observed",
    actualArrivalAt: "2026-01-06T12:14:00Z", observedAt: "2026-01-06T12:14:30Z", modelVersion: "tree", outcomeSource: "schedule_actual" },
    { vehicleId: "vehicle-2", routeId: "duty-2", targetStopId: "201", stopName: "Улица",
      issuedAt: "2026-01-06T12:00:00Z", plannedAt: "2026-01-06T12:12:00Z", horizonSec: 720,
      predictedDelaySec: 240, actualDelaySec: null, absoluteErrorSec: null, status: "awaiting_observation",
      actualArrivalAt: null, observedAt: null, modelVersion: "tree", outcomeSource: null }],
};
it("compares the same targets and leaves missing observations out of the chart", () => {
  expect(pairedForecasts(report).map(row => row.targetStopId)).toEqual(["101"]);
  state.data = report;
  const html = renderToStaticMarkup(createElement(EvaluationPanel));
  expect(html).toContain("30.0 с");
  expect(html).toContain("+150 с");
  expect(html).toContain("+120 с");
  expect(html).toContain("Нет наблюдения");
  expect(html).toContain("12.0 мин");
});
it("explains the wait for a real outcome without presenting zero error", () => {
  state.data = { ...report, summary: { ...report.summary, observed: 0, maeSec: null }, items: report.items.slice(1) };
  const html = renderToStaticMarkup(createElement(EvaluationPanel));
  expect(html).toContain("Сравнение появится после наблюдения прибытия");
  expect(html).not.toContain("0.0 с");
});
