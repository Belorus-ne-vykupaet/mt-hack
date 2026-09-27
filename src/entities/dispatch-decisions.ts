import type { DispatchSettings } from "./dispatch-settings";
import type { DispatchPlan } from "./dispatch";
import type { Route } from "./models";
import type { LineBus, LineStop, RouteLine } from "./route-line";
import { nextLineStop, operatingSpeed, secondsTo } from "./route-line";

export type DecisionKind =
  | "hold_early"
  | "hold_bunching"
  | "shorten_late"
  | "shorten_all"
  | "add_bus";
export interface DecisionEffect {
  label: string;
  before: number;
  after: number;
  format: "delay" | "duration" | "count";
  better: boolean;
}
export interface DispatchDecision {
  id: string;
  routeId: string;
  kind: DecisionKind;
  vehicleId?: string;
  stopId?: string;
  stopName?: string;
  dwell?: { baseSec: number; targetSec: number; stops: number };
  fleet?: { current: number; target: number };
  holdSec?: number;
  deadlineInSec: number;
  deadlineAt: string;
  priority: number;
  title: string;
  summary: string;
  facts: string[];
  effects: DecisionEffect[];
  assumption: string;
}
export interface RouteAnalysis {
  routeId: string;
  status: "ok" | "no_geometry" | "insufficient";
  plannedHeadwaySec: number;
  /** Headway to the running bus ahead, per bus of line.buses; null at the front or a terminal. */
  headwayAhead: (number | null)[];
  /** Index in line.buses of the running bus behind; -1 when there is none. */
  follower: number[];
  averageWaitSec: number | null;
  fresh: LineBus[];
  late: LineBus[];
  line: RouteLine;
}
const HORIZON_SEC = 900;
const round10 = (s: number) => Math.round(s / 10) * 10;
const floor10 = (s: number) => Math.floor(s / 10) * 10;
export const busLabel = (id: string) => `ТС ${id.replace("vehicle-", "")}`;
export const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100,
    b = a % 10;
  return a > 10 && a < 20
    ? many
    : b === 1
      ? one
      : b >= 2 && b <= 4
        ? few
        : many;
};
const mmss = (sec: number) => {
  const s = Math.round(Math.abs(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const signed = (sec: number) => `${sec >= 0 ? "+" : "−"}${mmss(sec)}`;

/** Passenger wait at a stop with random arrivals: E[h²] / 2E[h]. */
export function averageWait(headways: number[]) {
  const known = headways.filter((h) => Number.isFinite(h) && h > 0);
  if (known.length < 2) return null;
  return (
    known.reduce((s, h) => s + h * h, 0) /
    (2 * known.reduce((s, h) => s + h, 0))
  );
}

// Buses this close to the first or last stop are laying over, not running in the line.
const TERMINAL_M = 60;
/**
 * Spacing model: running buses of a line should be evenly spread, one planned headway apart.
 * Planned headway = cycle ÷ fleet. The usual gap is the median gap between running buses
 * (the even share of the line when there are too few), so only local irregularity counts.
 */
export function analyzeRoute(
  line: RouteLine,
  settings: DispatchSettings,
  asOfMs: number,
): RouteAnalysis {
  const fleet = Math.max(1, line.route.activeVehicleCount);
  const plannedHeadwaySec = (settings.cycleMin * 60) / fleet;
  const fresh = line.buses.filter((b) => {
    const age = asOfMs - Date.parse(b.vehicle.updatedAt);
    return (
      Number.isFinite(age) &&
      age >= 0 &&
      age <= settings.freshSec * 1000 &&
      b.vehicle.hasForecast !== false &&
      b.vehicle.currentDelayKnown !== false &&
      !b.vehicle.telemetryStale &&
      Number.isFinite(b.vehicle.predictedDelaySec) &&
      Number.isFinite(b.vehicle.currentDelaySec)
    );
  });
  const first = line.stops[0]?.along ?? 0,
    last = line.stops.at(-1)?.along ?? line.length;
  const running = line.buses.map(
    (b) => b.along > first + TERMINAL_M && b.along < last - TERMINAL_M,
  );
  const leader = line.buses.map((_, i) => {
    if (!running[i]) return -1;
    for (let k = i + 1; k < line.buses.length; k++) if (running[k]) return k;
    return -1;
  });
  const follower = line.buses.map(() => -1);
  leader.forEach((k, i) => {
    if (k >= 0) follower[k] = i;
  });
  const gaps = leader.map((k, i) =>
    k >= 0 ? line.buses[k].along - line.buses[i].along : null,
  );
  const known = gaps.filter((g): g is number => g !== null).sort((a, b) => a - b);
  const spacing =
    known.length >= 4
      ? known[Math.floor(known.length / 2)]
      : line.length / fleet;
  const headwayAhead = gaps.map((g) =>
    g !== null && spacing > 0 ? (g / spacing) * plannedHeadwaySec : null,
  );
  const status = !line.path
    ? "no_geometry"
    : fresh.length < Math.max(1, Math.ceil(fleet / 2))
      ? "insufficient"
      : "ok";
  return {
    routeId: line.route.id,
    status,
    plannedHeadwaySec,
    headwayAhead,
    follower,
    averageWaitSec: averageWait(
      headwayAhead.filter((h): h is number => h !== null),
    ),
    fresh,
    late: fresh.filter((b) => b.vehicle.predictedDelaySec >= settings.lateSec),
    line,
  };
}

function stopsWithin(
  line: RouteLine,
  bus: LineBus,
  seconds: number,
): LineStop[] {
  const own = bus.vehicle.speedKmh / 3.6;
  const reach =
    bus.along +
    (Number.isFinite(own) && own >= 1 ? own : operatingSpeed(line)) * seconds;
  return line.stops.filter((s) => s.along > bus.along && s.along <= reach);
}

function headwayEffects(
  analysis: RouteAnalysis,
  index: number,
  shiftSec: number,
): DecisionEffect[] {
  const H = analysis.plannedHeadwaySec,
    ahead = analysis.headwayAhead[index],
    back = analysis.follower[index],
    behind = back >= 0 ? analysis.headwayAhead[back] : null;
  const effects: DecisionEffect[] = [];
  const closer = (before: number, after: number) =>
    Math.abs(after - H) < Math.abs(before - H);
  if (ahead !== null)
    effects.push({
      label: "Интервал до впереди идущего",
      before: ahead,
      after: Math.max(0, ahead + shiftSec),
      format: "duration",
      better: closer(ahead, ahead + shiftSec),
    });
  if (behind !== null)
    effects.push({
      label: "Интервал до идущего следом",
      before: behind,
      after: Math.max(0, behind - shiftSec),
      format: "duration",
      better: closer(behind, behind - shiftSec),
    });
  const shifted = analysis.headwayAhead.map((h, i) =>
    h === null
      ? null
      : i === index
        ? Math.max(0, h + shiftSec)
        : i === back
          ? Math.max(0, h - shiftSec)
          : h,
  );
  const before = analysis.averageWaitSec,
    after = averageWait(shifted.filter((h): h is number => h !== null));
  // Changes of a few seconds are noise at the route level.
  if (before !== null && after !== null && Math.abs(after - before) >= 5)
    effects.push({
      label: "Среднее ожидание на остановках маршрута",
      before,
      after,
      format: "duration",
      better: after < before - 0.5,
    });
  return effects;
}

function priorityOf(severity: number, deadlineInSec: number) {
  const urgency = 1 - Math.min(1, Math.max(0, deadlineInSec) / HORIZON_SEC);
  return Math.round((0.6 * severity + 0.4 * urgency) * 1000) / 1000;
}

function busDecision(
  analysis: RouteAnalysis,
  index: number,
  settings: DispatchSettings,
  asOfMs: number,
): DispatchDecision | null {
  const { line } = analysis,
    bus = line.buses[index],
    v = bus.vehicle;
  if (!analysis.fresh.includes(bus)) return null;
  const next = nextLineStop(line, bus);
  if (!next) return null;
  const H = analysis.plannedHeadwaySec,
    ahead = analysis.headwayAhead[index],
    back = analysis.follower[index],
    behind = back >= 0 ? analysis.headwayAhead[back] : null;
  const eta = Math.round(secondsTo(line, bus, next.along));
  const base = {
    routeId: line.route.id,
    vehicleId: v.id,
    stopId: next.stop.id,
    stopName: next.stop.name,
    deadlineInSec: eta,
    deadlineAt: new Date(asOfMs + eta * 1000).toISOString(),
  };
  const label = busLabel(v.id),
    early = Math.min(v.currentDelaySec, v.predictedDelaySec);
  // A hold must not squeeze the bus behind into a new bunch, nor exceed the 300 s dwell limit.
  const roomBehind = Math.min(
    behind === null ? Infinity : behind - settings.bunchingRatio * H,
    300 - settings.baseDwellSec,
  );
  if (early <= -settings.earlySec) {
    const hold = floor10(
      Math.min(round10(-early), settings.maxHoldSec, roomBehind),
    );
    if (hold < 20) return null;
    return {
      ...base,
      id: `hold_early:${v.id}`,
      kind: "hold_early",
      holdSec: hold,
      dwell: {
        baseSec: settings.baseDwellSec,
        targetSec: settings.baseDwellSec + hold,
        stops: 1,
      },
      priority: priorityOf(Math.min(1, -early / 300) * 0.8, eta),
      title: `Удержать ${label} на «${next.stop.name}» ${hold} с`,
      summary: `Идёт раньше графика на ${mmss(-early)}: без удержания уйдёт с остановки раньше расписания.`,
      facts: [
        `Сейчас ${signed(v.currentDelaySec)} к графику, прогноз через 15 мин ${signed(v.predictedDelaySec)}.`,
        ...(ahead !== null
          ? [`Интервал до впереди идущего ${mmss(ahead)} при плане ${mmss(H)}.`]
          : []),
      ],
      effects: [
        {
          label: `Отклонение ${label} от графика через 15 мин`,
          before: v.predictedDelaySec,
          after: v.predictedDelaySec + hold,
          format: "delay",
          better:
            Math.abs(v.predictedDelaySec + hold) <
            Math.abs(v.predictedDelaySec),
        },
        ...headwayEffects(analysis, index, hold),
      ],
      assumption:
        "Расчёт по правилу: удержание сдвигает автобус на то же время, остальные идут как в прогнозе.",
    };
  }
  if (
    ahead !== null &&
    ahead < settings.bunchingRatio * H &&
    v.predictedDelaySec < settings.lateSec
  ) {
    const target = ((1 + settings.bunchingRatio) / 2) * H;
    const hold = floor10(
      Math.min(
        round10(target - ahead),
        settings.maxHoldSec,
        roomBehind,
        settings.lateSec - Math.max(0, v.predictedDelaySec) - 10,
      ),
    );
    if (hold < 20) return null;
    const severity =
      Math.min(
        1,
        (settings.bunchingRatio * H - ahead) / (settings.bunchingRatio * H),
      ) *
        0.8 +
      0.1;
    return {
      ...base,
      id: `hold_bunching:${v.id}`,
      kind: "hold_bunching",
      holdSec: hold,
      dwell: {
        baseSec: settings.baseDwellSec,
        targetSec: settings.baseDwellSec + hold,
        stops: 1,
      },
      priority: priorityOf(severity, eta),
      title: `Удержать ${label} на «${next.stop.name}» ${hold} с`,
      summary: `Догоняет впереди идущий автобус: интервал ${mmss(ahead)} при плане ${mmss(H)}. Удержание разведёт их, пока не образовалась пара.`,
      facts: [
        `Интервал до впереди идущего ${mmss(ahead)} — ${Math.round((ahead / H) * 100)}% планового.`,
        ...(behind !== null
          ? [`Следом через ${mmss(behind)}: удержание не создаст новую пару.`]
          : []),
        `Отклонение от графика ${signed(v.currentDelaySec)}; после удержания останется в пределах порога опоздания.`,
      ],
      effects: [
        ...headwayEffects(analysis, index, hold),
        {
          label: `Отклонение ${label} от графика через 15 мин`,
          before: v.predictedDelaySec,
          after: v.predictedDelaySec + hold,
          format: "delay",
          better: false,
        },
      ],
      assumption:
        "Интервал оценён по расстоянию между автобусами при равномерном выпуске; удержание сдвигает только этот автобус.",
    };
  }
  // A late bus already closing in on its leader must not be sped up: that only deepens the pair.
  if (
    v.predictedDelaySec >= settings.lateSec &&
    (ahead === null || ahead >= settings.bunchingRatio * H)
  ) {
    const save = settings.baseDwellSec - settings.minDwellSec;
    if (save <= 0) return null;
    const stops = Math.max(1, stopsWithin(line, bus, HORIZON_SEC).length);
    // Drivers do not run ahead of the timetable, so the gain stops at zero delay.
    const gain = Math.min(save * stops, v.predictedDelaySec);
    return {
      ...base,
      id: `shorten_late:${v.id}`,
      kind: "shorten_late",
      dwell: {
        baseSec: settings.baseDwellSec,
        targetSec: settings.minDwellSec,
        stops,
      },
      priority: priorityOf(Math.min(1, v.predictedDelaySec / 600), eta),
      title: `Сократить стоянки ${label} до ${settings.minDwellSec} с на ${stops} ${plural(stops, "остановке", "остановках", "остановках")}`,
      summary: `Через 15 минут опоздание составит ${signed(v.predictedDelaySec)}. Стоянка только на посадку и высадку, начиная с «${next.stop.name}».`,
      facts: [
        `Сейчас ${signed(v.currentDelaySec)} к графику, прогноз через 15 мин ${signed(v.predictedDelaySec)}.`,
        `За 15 минут автобус пройдёт ${stops} ${plural(stops, "остановку", "остановки", "остановок")}; на каждой можно сэкономить до ${save} с.`,
        ...(ahead !== null && ahead > settings.gapRatio * H
          ? [`Впереди разрыв ${mmss(ahead)}: автобус собирает пассажиров за двоих.`]
          : []),
      ],
      effects: [
        {
          label: `Отклонение ${label} от графика через 15 мин`,
          before: v.predictedDelaySec,
          after: v.predictedDelaySec - gain,
          format: "delay",
          better: true,
        },
        ...headwayEffects(analysis, index, -gain),
      ],
      assumption: `Если посадка завершена раньше: по ${save} с на каждой из ${stops} ${plural(stops, "остановки", "остановок", "остановок")}. Пробку это не убирает.`,
    };
  }
  return null;
}

function congestionDecision(
  analysis: RouteAnalysis,
  settings: DispatchSettings,
  asOfMs: number,
): DispatchDecision | null {
  const { line, late, fresh } = analysis;
  const save = settings.baseDwellSec - settings.minDwellSec;
  if (save <= 0 || late.length < 4 || late.length / fresh.length < 0.8)
    return null;
  const worst = [...late].sort(
    (a, b) =>
      b.vehicle.predictedDelaySec - a.vehicle.predictedDelaySec ||
      a.vehicle.id.localeCompare(b.vehicle.id),
  )[0];
  const next = nextLineStop(line, worst);
  if (!next) return null;
  const stops = Math.max(1, stopsWithin(line, worst, HORIZON_SEC).length);
  const average =
    late.reduce((s, b) => s + b.vehicle.predictedDelaySec, 0) / late.length;
  const averageAfter =
    late.reduce(
      (s, b) => s + Math.max(0, b.vehicle.predictedDelaySec - save * stops),
      0,
    ) / late.length;
  const eta = Math.round(secondsTo(line, worst, next.along));
  return {
    id: `shorten_all:${line.route.id}`,
    routeId: line.route.id,
    kind: "shorten_all",
    stopId: next.stop.id,
    stopName: next.stop.name,
    dwell: {
      baseSec: settings.baseDwellSec,
      targetSec: settings.minDwellSec,
      stops,
    },
    deadlineInSec: eta,
    deadlineAt: new Date(asOfMs + eta * 1000).toISOString(),
    priority: priorityOf(Math.min(1, average / 600) * 0.9, eta),
    title: `Сократить стоянки всем автобусам маршрута до ${settings.minDwellSec} с`,
    summary: `Отстают ${late.length} из ${fresh.length} автобусов: замедление по всему маршруту. Причина — дорожная ситуация, стоянки компенсируют только часть опоздания.`,
    facts: [
      `Среднее опоздание через 15 минут ${signed(average)}.`,
      "Интервалы между автобусами сохраняются: удержание не поможет, дополнительный автобус не ускорит поток.",
    ],
    effects: [
      {
        label: "Среднее опоздание через 15 мин",
        before: average,
        after: averageAfter,
        format: "delay",
        better: true,
      },
    ],
    assumption: `Если посадка завершена раньше: по ${save} с на каждой из ~${stops} остановок за 15 минут.`,
  };
}

function fleetDecision(
  analysis: RouteAnalysis,
  settings: DispatchSettings,
  asOfMs: number,
  available: number,
): { decision: DispatchDecision | null; wanted: number } {
  const { line, late, fresh } = analysis;
  const H = analysis.plannedHeadwaySec;
  const fraction = fresh.length ? late.length / fresh.length : 0;
  const maxGap = Math.max(
    0,
    ...analysis.headwayAhead.filter((h): h is number => h !== null),
  );
  const burden = late.reduce((s, b) => s + b.vehicle.predictedDelaySec, 0);
  const gap = maxGap >= settings.gapRatio * H;
  // In a route-wide slowdown an extra bus does not speed traffic up; it only fills a real gap.
  const wanted =
    fraction >= 0.8 && late.length >= 4
      ? gap
        ? 1
        : 0
      : late.length >= 2 && fraction >= 0.25
      ? fraction >= 0.5 && burden / late.length >= 240
        ? 2
        : 1
      : late.length >= 1 && gap
        ? 1
        : 0;
  const extra = Math.min(wanted, Math.max(0, available));
  if (!extra) return { decision: null, wanted };
  const fleet = line.route.activeVehicleCount,
    target = fleet + extra;
  const onLine = new Date(asOfMs + settings.deployMin * 60000);
  const wait = analysis.averageWaitSec;
  return {
    wanted,
    decision: {
      id: `add_bus:${line.route.id}`,
      routeId: line.route.id,
      kind: "add_bus",
      fleet: { current: fleet, target },
      deadlineInSec: 0,
      deadlineAt: new Date(asOfMs).toISOString(),
      priority: priorityOf(Math.min(1, fraction) * 0.8, 0),
      title: `Выпустить ${extra} ${plural(extra, "автобус", "автобуса", "автобусов")} из резерва`,
      summary: `Отстают ${late.length} из ${fresh.length} автобусов${maxGap >= settings.gapRatio * H ? `, между ними разрыв до ${mmss(maxGap)}` : ""}. Резерв выйдет на линию примерно к ${onLine.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })}.`,
      facts: [
        `Суммарное прогнозное опоздание ${Math.round(burden / 60)} мин.`,
        `Плановый интервал ${mmss(H)} при выпуске ${fleet}.`,
      ],
      effects: [
        {
          label: "Плановый интервал",
          before: H,
          after: (settings.cycleMin * 60) / target,
          format: "duration",
          better: true,
        },
        ...(wait !== null
          ? [
              {
                label: "Среднее ожидание на остановках маршрута",
                before: wait,
                after: (wait * fleet) / target,
                format: "duration" as const,
                better: true,
              },
            ]
          : []),
      ],
      assumption: `Через ${settings.deployMin} мин после команды, если резервный автобус закроет самый большой разрыв. Опоздание уже идущих автобусов не уменьшает.`,
    },
  };
}

/** All actionable decisions, most urgent and severe first. Pure: plans and inputs are not changed. */
export function decideDispatch({
  lines,
  settings,
  asOf,
  reserve,
  blockedRoutes = new Set<string>(),
}: {
  lines: RouteLine[];
  settings: DispatchSettings;
  asOf: string;
  reserve: number;
  blockedRoutes?: Set<string>;
}) {
  const asOfMs = Date.parse(asOf);
  const analyses = new Map<string, RouteAnalysis>();
  const byRoute = new Map<string, DispatchDecision[]>();
  const reserveShort = new Set<string>();
  if (!Number.isFinite(asOfMs))
    return { analyses, byRoute, decisions: [], reserveShort };
  for (const line of lines) {
    const analysis = analyzeRoute(line, settings, asOfMs);
    analyses.set(line.route.id, analysis);
    if (analysis.status !== "ok" || blockedRoutes.has(line.route.id)) continue;
    const congestion = congestionDecision(analysis, settings, asOfMs);
    const own = congestion
      ? [congestion]
      : line.buses
          .map((_, i) => busDecision(analysis, i, settings, asOfMs))
          .filter((d): d is DispatchDecision => d !== null)
          .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
          .slice(0, 3);
    byRoute.set(line.route.id, own);
  }
  // The shared reserve goes once, to the routes with the heaviest delay burden.
  let available = reserve;
  const burden = (a: RouteAnalysis) =>
    a.late.reduce((s, b) => s + b.vehicle.predictedDelaySec, 0);
  const candidates = [...analyses.values()]
    .filter((a) => a.status === "ok" && !blockedRoutes.has(a.routeId))
    .sort((a, b) => burden(b) - burden(a) || a.routeId.localeCompare(b.routeId));
  for (const analysis of candidates) {
    const { decision, wanted } = fleetDecision(
      analysis,
      settings,
      asOfMs,
      available,
    );
    if (decision) {
      available -= decision.fleet!.target - decision.fleet!.current;
      byRoute.set(analysis.routeId, [
        ...(byRoute.get(analysis.routeId) || []),
        decision,
      ]);
    } else if (wanted) reserveShort.add(analysis.routeId);
  }
  const decisions = [...byRoute.values()]
    .flat()
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        a.deadlineInSec - b.deadlineInSec ||
        a.id.localeCompare(b.id),
    );
  return { analyses, byRoute, decisions, reserveShort };
}

/** The plan that carries out one decision; the route keeps a single active plan. */
export function planFromDecision(
  decision: DispatchDecision,
  route: Route,
  settings: DispatchSettings,
): DispatchPlan {
  const stop =
    route.stops.find((s) => s.id === decision.stopId) || route.stops[0];
  return {
    id: "preview",
    routeId: route.id,
    routeNumber: route.number,
    baseFleet: route.activeVehicleCount,
    targetFleet: decision.fleet?.target ?? route.activeVehicleCount,
    cycleMin: settings.cycleMin,
    stopId: stop?.id || "",
    stopName: stop?.name || "",
    baseDwellSec: decision.dwell?.baseSec ?? settings.baseDwellSec,
    targetDwellSec: decision.dwell?.targetSec ?? settings.baseDwellSec,
    createdAt: "",
    status: "draft",
    decisionKind: decision.kind,
    ...(decision.vehicleId ? { vehicleId: decision.vehicleId } : {}),
    ...(decision.dwell ? { dwellStops: decision.dwell.stops } : {}),
  };
}
