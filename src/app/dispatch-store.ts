import { create } from "zustand";
import { persist } from "zustand/middleware";
import { evaluatePlan, reserveRemaining } from "../entities/dispatch";
import type { DispatchPlan } from "../entities/dispatch";
interface DispatchState {
  plans: DispatchPlan[];
  save: (plan: DispatchPlan, activate: boolean) => void;
  cancel: (id: string) => void;
}
export const useDispatch = create<DispatchState>()(
  persist(
    (set) => ({
      plans: [],
      save: (plan, activate) =>
        set((state) => {
          evaluatePlan(plan);
          if (activate && reserveRemaining(state.plans, plan) < 0)
            throw new Error(
              "Недостаточно автобусов в демонстрационном резерве.",
            );
          const plans = state.plans.map((p) =>
            activate && p.status === "active" && p.routeId === plan.routeId
              ? { ...p, status: "replaced" as const }
              : p,
          );
          const next = {
            ...plan,
            status: activate ? ("active" as const) : ("draft" as const),
          };
          return {
            plans: [next, ...plans].filter(
              (p, i) => i < 50 || p.status === "active",
            ),
          };
        }),
      cancel: (id) =>
        set((state) => ({
          plans: state.plans.map((p) =>
            p.id === id ? { ...p, status: "cancelled" as const } : p,
          ),
        })),
    }),
    { name: "transit-dispatch-plans-v1", version: 1 },
  ),
);
