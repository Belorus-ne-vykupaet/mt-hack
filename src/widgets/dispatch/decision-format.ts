import type {
  DecisionKind,
  DispatchDecision,
} from "../../entities/dispatch-decisions";

export const decisionKindLabel: Record<DecisionKind, string> = {
  hold_early: "Удержание до графика",
  hold_bunching: "Разведение пары",
  shorten_late: "Сокращение стоянок",
  shorten_all: "Весь маршрут",
  add_bus: "Резерв",
};
export const mmss = (sec: number) => {
  const s = Math.round(Math.abs(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
/** «сейчас» for immediate actions, otherwise the time left and the clock time. */
export function deadlineLabel(decision: DispatchDecision) {
  if (decision.kind === "add_bus") return "выпуск сейчас";
  if (decision.deadlineInSec <= 0) return "сейчас у остановки";
  return `за ${mmss(decision.deadlineInSec)} · до ${clockTime(decision.deadlineAt)}`;
}
/** Urgent: the bus is about to reach the stop where the action must happen. */
export const urgency = (decision: DispatchDecision) =>
  decision.kind === "add_bus"
    ? "soon"
    : decision.deadlineInSec <= 30
      ? "urgent"
      : decision.deadlineInSec <= 120
        ? "soon"
        : "later";
