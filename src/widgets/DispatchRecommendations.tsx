import { ArrowRight } from "lucide-react";

/** Compact before/after value used by the manual dispatch plan. */
export function RecommendationValue({
  before,
  after,
  unit = "",
}: {
  before: number | null;
  after: number | null;
  unit?: string;
}) {
  return <span className="recommend-value">
    <span>{before ?? "—"}{before !== null && unit}</span>
    <ArrowRight size={13} />
    <strong className={before !== after ? "changed" : ""}>{after ?? "—"}{after !== null && unit}</strong>
  </span>;
}
