import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  evaluatePlan,
  planTarget,
  reserveRemaining,
} from "../src/entities/dispatch";
import type { DispatchPlan } from "../src/entities/dispatch";
import type { RouteDto } from "../src/shared/api/generated/models";
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export interface Command {
  id: string;
  plan: DispatchPlan;
  status: "draft" | "applied_demo" | "cancelled" | "replaced";
  history: { status: string; at: string }[];
  requestKey: string;
  fingerprint: string;
}
interface State {
  revision: number;
  commands: Command[];
}
export class DispatchService {
  state: State;
  constructor(privatePath: string | undefined, routes: RouteDto[]) {
    this.path = privatePath;
    this.routes = routes;
    this.state =
      privatePath && existsSync(privatePath)
        ? JSON.parse(readFileSync(privatePath, "utf8"))
        : { revision: 0, commands: [] };
    if (
      !Number.isInteger(this.state.revision) ||
      !Array.isArray(this.state.commands)
    )
      throw new Error("Invalid command journal");
  }
  private path?: string;
  private routes: RouteDto[];
  get plans() {
    return this.state.commands.map((c) => c.plan);
  }
  publicState() {
    return {
      revision: this.state.revision,
      reserve: reserveRemaining(this.plans),
      commands: this.state.commands.map(
        ({ requestKey: _key, fingerprint: _fp, ...c }) => c,
      ),
    };
  }
  private commit(next: State) {
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(`${this.path}.tmp`, JSON.stringify(next), { mode: 0o600 });
      renameSync(`${this.path}.tmp`, this.path);
    }
    this.state = next;
  }
  submit(
    input: { plan: DispatchPlan; mode: "plan" | "apply"; revision: number },
    key: string,
  ) {
    if (!key || key.length > 100)
      throw new ApiError(400, "Нужен Idempotency-Key (до 100 символов).");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const existing = this.state.commands.find((c) => c.requestKey === key);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new ApiError(
          409,
          "Ключ запроса уже использован для другого решения.",
        );
      return this.publicState();
    }
    if (input.revision !== this.state.revision)
      throw new ApiError(
        409,
        "Состояние изменилось. Обновите журнал и проверьте резерв.",
      );
    if (!["plan", "apply"].includes(input.mode))
      throw new ApiError(400, "Неизвестный режим команды.");
    const p = input.plan;
    const route = this.routes.find((r) => r.id === p?.routeId);
    const stop = route?.stops.find((s) => s.id === p?.stopId);
    if (!route || !stop)
      throw new ApiError(422, "Маршрут или остановка не найдены.");
    try {
      evaluatePlan(p);
    } catch (e) {
      throw new ApiError(422, (e as Error).message);
    }
    if (p.baseFleet !== route.vehicle_count)
      throw new ApiError(
        409,
        "Исходный выпуск не совпадает с данными сервера.",
      );
    if (input.mode === "apply" && p.targetDwellSec < 20)
      throw new ApiError(422, "Минимальная стоянка учебного API — 20 секунд.");
    const at = new Date().toISOString(),
      id = randomUUID();
    const plan: DispatchPlan = {
      id,
      routeId: route.id,
      routeNumber: route.number,
      baseFleet: route.vehicle_count,
      targetFleet: p.targetFleet,
      cycleMin: p.cycleMin,
      stopId: stop.id,
      stopName: stop.name,
      baseDwellSec: p.baseDwellSec,
      targetDwellSec: p.targetDwellSec,
      createdAt: at,
      status: input.mode === "apply" ? "active" : "draft",
      ...planTarget(p),
    };
    if (input.mode === "apply" && reserveRemaining(this.plans, plan) < 0)
      throw new ApiError(409, "В общем резерве недостаточно автобусов.");
    if (this.state.commands.length >= 5000)
      throw new ApiError(
        507,
        "Журнал заполнен. Требуется архивирование администратором.",
      );
    const commands = structuredClone(this.state.commands);
    if (input.mode === "apply")
      for (const c of commands)
        if (c.plan.routeId === route.id && c.status === "applied_demo") {
          c.status = "replaced";
          c.plan.status = "replaced";
          c.history.push({ status: "replaced", at });
        }
    const status =
      input.mode === "apply" ? ("applied_demo" as const) : ("draft" as const);
    commands.unshift({
      id,
      plan,
      status,
      requestKey: key,
      fingerprint,
      history: [
        { status: "accepted", at },
        { status, at },
      ],
    });
    this.commit({ revision: this.state.revision + 1, commands });
    return this.publicState();
  }
  cancel(id: string, revision: number) {
    const found = this.state.commands.find((c) => c.id === id);
    if (!found) throw new ApiError(404, "Команда не найдена.");
    if (found.status === "cancelled") return this.publicState();
    if (revision !== this.state.revision)
      throw new ApiError(409, "Журнал изменился. Обновите данные.");
    if (found.status === "replaced")
      throw new ApiError(409, "Решение уже заменено новой командой.");
    const commands = structuredClone(this.state.commands),
      c = commands.find((c) => c.id === id)!;
    c.status = "cancelled";
    c.plan.status = "cancelled";
    c.history.push({ status: "cancelled", at: new Date().toISOString() });
    this.commit({ revision: this.state.revision + 1, commands });
    return this.publicState();
  }
}
