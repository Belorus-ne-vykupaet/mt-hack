import { useDispatch } from "../app/dispatch-store";
import { simulateDispatch } from "../entities/dispatch-simulation";
import type { scenarioSnapshot } from "./scenario";
export function applyDispatch(snapshot: ReturnType<typeof scenarioSnapshot>) {
  return simulateDispatch(snapshot, useDispatch.getState().plans);
}
