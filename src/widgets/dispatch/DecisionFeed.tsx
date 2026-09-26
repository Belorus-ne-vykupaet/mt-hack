import {
  ArrowRight,
  BusFront,
  Check,
  Clock3,
  PauseCircle,
  Route as RouteIcon,
  SlidersHorizontal,
  Timer,
} from "lucide-react";
import type {
  DecisionEffect,
  DispatchDecision,
} from "../../entities/dispatch-decisions";
import { busLabel } from "../../entities/dispatch-decisions";
import {
  deadlineLabel,
  decisionKindLabel,
  mmss,
  urgency,
} from "./decision-format";

const kindIcon = {
  hold_early: PauseCircle,
  hold_bunching: PauseCircle,
  shorten_late: Timer,
  shorten_all: RouteIcon,
  add_bus: BusFront,
};
const effectValue = (value: number, format: DecisionEffect["format"]) =>
  format === "delay"
    ? `${value >= 0 ? "+" : "−"}${mmss(value)}`
    : format === "duration"
      ? mmss(value)
      : String(Math.round(value));

export function DecisionEffects({ effects }: { effects: DecisionEffect[] }) {
  return (
    <dl className="decision-effects">
      {effects.map((e) => (
        <div key={e.label} className={e.better ? "better" : "tradeoff"}>
          <dt>{e.label}</dt>
          <dd>
            <span>{effectValue(e.before, e.format)}</span>
            <ArrowRight size={13} aria-label="станет" />
            <strong>{effectValue(e.after, e.format)}</strong>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DecisionFeed({
  routeNumber,
  decisions,
  selectedId,
  onSelect,
  onApply,
  onPrefill,
  applyLabel,
  applyDisabled,
  busy,
  error,
  status,
  statusText,
}: {
  routeNumber: string;
  decisions: DispatchDecision[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onApply: (decision: DispatchDecision) => void;
  onPrefill: (decision: DispatchDecision) => void;
  applyLabel: string;
  applyDisabled: string;
  busy: boolean;
  error: string;
  status: string;
  statusText: string;
}) {
  const selected =
    decisions.find((d) => d.id === selectedId) || decisions[0] || undefined;
  return (
    <section className="decision-feed" aria-label={`Решения по маршруту ${routeNumber}`}>
      <div className="decision-feed-heading">
        <div>
          <span className="dispatch-eyebrow">
            <SlidersHorizontal size={13} /> РЕШЕНИЯ НА 15 МИНУТ
          </span>
          <h3>Что сделать на маршруте {routeNumber}</h3>
        </div>
        <span className="decision-method">Правила · без ML</span>
      </div>
      {!decisions.length ? (
        <p className={`decision-empty ${status}`}>
          {status === "active" ? <Check size={16} /> : <Clock3 size={16} />}
          {statusText}
        </p>
      ) : (
        <>
          {decisions.length > 0 && (
            <div className="decision-tabs" role="tablist" aria-label="Решения маршрута">
              {decisions.map((d) => {
                const Icon = kindIcon[d.kind];
                return (
                  <button
                    key={d.id}
                    role="tab"
                    aria-selected={d.id === selected?.id}
                    className={`decision-tab ${urgency(d)}`}
                    onClick={() => onSelect(d.id)}
                  >
                    <Icon size={15} />
                    <span>{decisionKindLabel[d.kind]}</span>
                    <small>
                      {d.vehicleId ? `${busLabel(d.vehicleId)} · ` : ""}
                      {deadlineLabel(d)}
                    </small>
                  </button>
                );
              })}
            </div>
          )}
          {selected && (
            <article
              className={`decision-card ${urgency(selected)}`}
              data-decision={selected.kind}
              data-vehicle={selected.vehicleId || ""}
            >
              <div className="decision-card-top">
                <span className="decision-kind">
                  {decisionKindLabel[selected.kind]}
                </span>
                <span className={`decision-deadline ${urgency(selected)}`}>
                  <Clock3 size={13} />
                  {deadlineLabel(selected)}
                </span>
              </div>
              <h4>{selected.title}</h4>
              <p>{selected.summary}</p>
              {selected.facts.length > 0 && (
                <ul className="decision-facts">
                  {selected.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
              <div className="decision-effect-block">
                <span className="dispatch-simulation-label">
                  ЧТО ИЗМЕНИТСЯ · РАСЧЁТ ПО ПРАВИЛУ, НЕ ML
                </span>
                <DecisionEffects effects={selected.effects} />
                <small>{selected.assumption}</small>
              </div>
              <div className="decision-actions">
                <button
                  className="primary-button"
                  disabled={busy || !!applyDisabled}
                  title={applyDisabled || undefined}
                  onClick={() => onApply(selected)}
                >
                  {applyLabel}
                  <Check size={15} />
                </button>
                <button
                  className="dispatch-secondary"
                  onClick={() => onPrefill(selected)}
                >
                  Подставить в форму
                </button>
              </div>
              {applyDisabled && <small className="decision-note">{applyDisabled}</small>}
              {error && (
                <p className="dispatch-error" role="alert">
                  {error}
                </p>
              )}
            </article>
          )}
        </>
      )}
    </section>
  );
}
