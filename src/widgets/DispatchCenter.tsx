import { TrafficNotices } from "./TrafficNotices";
import { matchesSearch } from "../shared/lib/search";
import { useEffect, useRef, useState } from "react";
import {
  BusFront,
  Clock3,
  ArrowRight,
  RotateCcw,
  Check,
  ClipboardList,
  MapPin,
  SlidersHorizontal,
  Route as RouteIcon,
  Search,
  AlertTriangle,
  CircleCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDispatch } from "../app/dispatch-store";
import { useUi, useConnection } from "../app/store";
import { config } from "../shared/config/env";
import { evaluatePlan, reserveRemaining } from "../entities/dispatch";
import type { DispatchPlan } from "../entities/dispatch";
import type { Geometry, Route, Vehicle } from "../entities/models";
import { queryClient, resync } from "../entities/queries";
import { RouteBadge } from "../shared/ui/primitives";
import "../styles/dispatch.css";
import "../styles/integrations.css";
import {
  useApiDispatch,
  integrationRequest,
  refreshApiDispatch,
  commandKey,
} from "../shared/api/integrations";
import type { CommandState } from "../shared/api/integrations";
import { recommendDispatch } from "../entities/dispatch-recommendations";
import type { DispatchRecommendation } from "../entities/dispatch-recommendations";
import { RecommendationValue } from "./DispatchRecommendations";
import { useDispatchSettings } from "../app/dispatch-settings-store";
import type { DispatchSettings } from "../entities/dispatch-settings";
import {
  busLabel,
  planFromDecision,
  plural,
} from "../entities/dispatch-decisions";
import type { DispatchDecision } from "../entities/dispatch-decisions";
import { DecisionFeed } from "./dispatch/DecisionFeed";
import {
  deadlineLabel,
  decisionKindLabel,
  urgency,
} from "./dispatch/decision-format";
import { VehicleBoard } from "./dispatch/VehicleBoard";
import type { ContactTarget } from "./dispatch/VehicleBoard";
import { GigachatPanel } from "./dispatch/GigachatPanel";
import { YandexWeatherBrief } from "./dispatch/YandexWeatherBrief";
import { DispatchSettingsPanel } from "./dispatch/DispatchSettingsPanel";
import { NetworkScenariosDrawer } from "./dispatch/NetworkScenariosDrawer";
import { usePlanSubmit } from "./dispatch/usePlanSubmit";
/** Targeting of a plan (one bus, several stops), taken from a suggestion or an applied plan. */
type Target = Pick<DispatchPlan, "vehicleId" | "decisionKind" | "dwellStops">;
const targetOf = (
  source?:
    | Pick<DispatchPlan, "vehicleId" | "decisionKind" | "dwellStops">
    | Pick<
        DispatchRecommendation,
        "vehicleId" | "decisionKind" | "dwellStops"
      >,
): Target => ({
  ...(source?.vehicleId ? { vehicleId: source.vehicleId } : {}),
  ...(source?.decisionKind ? { decisionKind: source.decisionKind } : {}),
  ...(source?.dwellStops ? { dwellStops: source.dwellStops } : {}),
});
const duration = (minutes: number) => {
  const seconds = Math.round(minutes * 60);
  return `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
};
export default function DispatchCenter({
  routes,
  vehicles,
  asOf,
  geometries,
}: {
  routes: Route[];
  vehicles: Vehicle[];
  asOf?: string;
  geometries?: Geometry[];
}) {
  const selected = useUi((s) => s.selectedRouteId);
  const online = useConnection((s) => s.status === "connected");
  const [routeId, setRouteId] = useState(selected || routes[0]?.id || "");
  const [queueQuery, setQueueQuery] = useState("");
  const [queueFilter, setQueueFilter] = useState<
    "all" | "suggested" | "active"
  >("all");
  const route = routes.find((r) => r.id === routeId) || routes[0];
  const settings = useDispatchSettings((s) => s.settings);
  const local = useDispatch();
  const api = useApiDispatch();
  const [apiNow, setApiNow] = useState(() => Date.now());
  useEffect(() => {
    if (!config.dispatchApi) return;
    const tick = () => { if (!document.hidden) setApiNow(Date.now()); };
    const timer = setInterval(tick, 5000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);
  const plans = config.dispatchApi
    ? api.commands.data?.commands.map((c) => c.plan) || []
    : local.plans;
  const [notice, setNotice] = useState("");
  const canApply =
    !config.officialMode &&
    (config.dispatchApi || (config.dataSource === "mock" && !config.csvMode));
  const [prepared, setPrepared] = useState<{
    item: DispatchRecommendation;
    version: number;
  } | null>(null);
  const plannerRef = useRef<HTMLDivElement>(null);
  const recommendations = config.dispatchApi
    ? !api.recommendations.isError &&
      api.recommendations.data &&
      Date.parse(api.recommendations.data.expiresAt) > apiNow &&
      api.recommendations.data.revision === api.commands.data?.revision
      ? api.recommendations.data.items
      : []
    : recommendDispatch({
        routes,
        vehicles,
        plans,
        asOf,
        demo: canApply,
        online,
        geometries,
        settings,
      });
  const recommendation = recommendations.find((r) => r.routeId === route?.id);
  const suggestedCount = recommendations.filter(
    (r) => r.status === "suggested",
  ).length;
  const affectedCount = recommendations.reduce(
    (sum, r) => sum + r.affectedVehicles,
    0,
  );
  const visibleQueue = recommendations.filter((item) => {
    const candidate = routes.find((r) => r.id === item.routeId);
    const matchesQuery = matchesSearch(
      `${candidate?.number || ""} ${candidate?.name || ""}`,
      queueQuery,
    );
    return (
      matchesQuery && (queueFilter === "all" || item.status === queueFilter)
    );
  });
  const [decisionId, setDecisionId] = useState<string>();
  const [contact, setContact] = useState<ContactTarget | null>(null);
  const [networkOpen, setNetworkOpen] = useState(false);
  const decisionSubmit = usePlanSubmit(setNotice);
  const decisions = recommendation?.decisions || [];
  const decision = decisions.find((d) => d.id === decisionId) || decisions[0];
  const urgentCount = recommendations.filter(
    (r) => r.decisions?.[0] && urgency(r.decisions[0]) === "urgent",
  ).length;
  const focusRoute = (id: string) => {
    setRouteId(id);
    setPrepared(null);
    setNotice("");
    setDecisionId(undefined);
    setContact(null);
    decisionSubmit.setError("");
    useUi.getState().selectRoute(id);
  };
  useEffect(() => {
    if (prepared)
      plannerRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
  }, [prepared]);
  const choose = (item: DispatchRecommendation) => {
    setRouteId(item.routeId);
    useUi.getState().selectRoute(item.routeId);
    setPrepared((previous) => ({
      item,
      version: (previous?.version || 0) + 1,
    }));
    setNotice(
      "Подсказки подставлены в форму. Проверьте план перед применением.",
    );
  };
  if (!route)
    return <div className="empty">Нет маршрутов для планирования.</div>;
  const active = plans.filter((p) => p.status === "active");
  const applyDecision = async (d: DispatchDecision) => {
    const draft = planFromDecision(d, route, settings);
    if (canApply && reserveRemaining(plans, draft) < 0) {
      decisionSubmit.setError(
        "В общем резерве недостаточно автобусов для этого решения.",
      );
      return;
    }
    if (await decisionSubmit.submit(draft, canApply)) setDecisionId(undefined);
  };
  const prefillDecision = (d: DispatchDecision) => {
    if (!recommendation) return;
    const draft = planFromDecision(d, route, settings);
    choose({
      ...recommendation,
      status: "suggested",
      targetFleet: draft.targetFleet,
      cycleMin: draft.cycleMin,
      stopId: draft.stopId,
      stopName: draft.stopName,
      currentDwellSec: draft.baseDwellSec,
      targetDwellSec: draft.targetDwellSec,
      vehicleId: d.vehicleId || null,
      decisionKind: d.kind,
      dwellStops: d.dwell?.stops ?? null,
    });
  };
  const decisionBlocked =
    canApply && !online
      ? "Поток недоступен: применить решение нельзя, дождитесь свежих данных."
      : decisionSubmit.apiUnavailable
        ? "API недоступен: дождитесь загрузки серверного журнала."
        : "";
  const undo = async (id: string) => {
    const plan = plans.find((p) => p.id === id);
    if (config.dispatchApi) {
      try {
        const result = await integrationRequest<CommandState>(
          `/dispatch/commands/${encodeURIComponent(id)}/cancel`,
          {
            method: "POST",
            body: JSON.stringify({ revision: api.commands.data?.revision }),
          },
        );
        queryClient.setQueryData(commandKey, result);
        await refreshApiDispatch();
        try {
          await resync();
        } catch {
          setNotice(
            "Сервер подтвердил отмену. Данные карты пока не обновились; дождитесь восстановления подключения.",
          );
          return;
        }
        setNotice("Сервер подтвердил отмену команды.");
      } catch (e) {
        setNotice((e as Error).message);
        await refreshApiDispatch();
      }
      return;
    }
    local.cancel(id);
    if (plan?.status === "active") {
      try {
        await resync();
      } catch {
        setNotice(
          "Сценарий отменён. Данные карты пока не обновились; дождитесь восстановления подключения.",
        );
        return;
      }
    }
    setNotice(
      plan?.status === "active"
        ? "Сценарий отменён. Исходные параметры восстановлены."
        : "План отменён. Данные сети не менялись.",
    );
  };
  return (
    <section className="dispatch-center">
      <TrafficNotices vehicles={vehicles}/>
      {config.dispatchApi && (api.commands.isError || api.recommendations.isError) && (
        <div className="api-dispatch-notice">
            <p role="alert">
              {api.commands.error?.message ||
                api.recommendations.error?.message}{" "}
              <button onClick={() => void refreshApiDispatch()}>
                Повторить подключение
              </button>
            </p>
        </div>
      )}
      <div className="dispatch-toolbar">
        <div>
          <span className="dispatch-eyebrow">РАБОЧЕЕ МЕСТО ДИСПЕТЧЕРА</span>
          <h2>Автобусы и решения на ближайшие 15 минут</h2>
          <p>
            Выберите маршрут, проверьте прогноз каждого автобуса и подготовьте
            действие для водителя.
          </p>
        </div>
        <span className={`dispatch-live ${online ? "online" : "offline"}`}>
          <i />
          {online ? "Данные обновляются" : "Нет свежего потока"}
        </span>
      </div>
      <YandexWeatherBrief />
      <div className="dispatch-brief" aria-label="Сводка диспетчера">
        <button
          className={queueFilter === "suggested" ? "selected" : ""}
          onClick={() => setQueueFilter("suggested")}
        >
          <RouteIcon size={17} />
          <strong>{suggestedCount}</strong>
          <span>маршрутов с предложением</span>
        </button>
        <div>
          <AlertTriangle size={17} />
          <strong>{affectedCount}</strong>
          <span>автобусов с риском задержки</span>
        </div>
        <button
          className={queueFilter === "active" ? "selected" : ""}
          onClick={() => setQueueFilter("active")}
        >
          <CircleCheck size={17} />
          <strong>{active.length}</strong>
          <span>активных демосценариев</span>
        </button>
        <div>
          <BusFront size={17} />
          <strong>{canApply ? reserveRemaining(plans) : "—"}</strong>
          <span>
            {canApply ? "автобусов в деморезерве" : "резерв не подключён"}
          </span>
        </div>
      </div>
      {urgentCount > 0 && (
        <p className="dispatch-urgent" role="status">
          <Clock3 size={15} />
          {urgentCount}{" "}
          {plural(urgentCount, "маршрут требует", "маршрута требуют", "маршрутов требуют")}{" "}
          решения в ближайшие 30 секунд: автобус подходит к остановке, где
          нужно действовать.
        </p>
      )}
      <DispatchSettingsPanel apiMode={config.dispatchApi} />
      <button className="network-drawer-trigger" onClick={() => setNetworkOpen(true)}><RouteIcon size={16}/> Обзор всех маршрутов <span>{routes.length}</span><ArrowRight size={15}/></button>
      <div className="dispatch-workspace">
        <aside className="dispatch-queue" aria-label="Очередь маршрутов">
          <div className="dispatch-queue-heading">
            <div>
              <span className="dispatch-eyebrow">ОЧЕРЕДЬ</span>
              <h3>Маршруты</h3>
            </div>
            <span>
              {visibleQueue.length} из {routes.length}
            </span>
          </div>
          <label className="dispatch-queue-search">
            <Search size={16} />
            <input
              aria-label="Поиск маршрута в диспетчерской"
              placeholder="Номер или направление"
              value={queueQuery}
              onChange={(event) => setQueueQuery(event.target.value)}
            />
          </label>
          <div className="dispatch-queue-filters" aria-label="Фильтр очереди">
            <button
              aria-pressed={queueFilter === "all"}
              onClick={() => setQueueFilter("all")}
            >
              Все
            </button>
            <button
              aria-pressed={queueFilter === "suggested"}
              onClick={() => setQueueFilter("suggested")}
            >
              С предложением
            </button>
            <button
              aria-pressed={queueFilter === "active"}
              onClick={() => setQueueFilter("active")}
            >
              Активные
            </button>
          </div>
          <div className="dispatch-queue-list">
            {visibleQueue.length ? (
              visibleQueue.map((item) => {
                const candidate = routes.find((r) => r.id === item.routeId);
                if (!candidate) return null;
                const delay = item.predictedDelaySec;
                const statusLabel = {
                  suggested: "Есть предложение",
                  active: "Сценарий активен",
                  unavailable: "Мало данных",
                  keep: "Без изменений",
                }[item.status];
                return (
                  <button
                    key={item.routeId}
                    className={`dispatch-queue-item ${route.id === item.routeId ? "selected" : ""}`}
                    aria-pressed={route.id === item.routeId}
                    onClick={() => focusRoute(item.routeId)}
                  >
                    <span className="dispatch-queue-top">
                      <RouteBadge
                        number={candidate.number}
                        risk={candidate.riskLevel}
                      />
                      <strong>
                        {delay === null
                          ? "Нет прогноза"
                          : `${delay > 0 ? "+" : ""}${(delay / 60).toFixed(1)} мин`}
                      </strong>
                    </span>
                    <span className="dispatch-queue-name">
                      {candidate.name}
                    </span>
                    {item.decisions?.[0] && (
                      <span
                        className={`dispatch-queue-action ${urgency(item.decisions[0])}`}
                      >
                        <strong>{decisionKindLabel[item.decisions[0].kind]}</strong>
                        <span>{deadlineLabel(item.decisions[0])}</span>
                      </span>
                    )}
                    <span className="dispatch-queue-bottom">
                      <span>
                        {item.currentFleet} автобусов · {item.affectedVehicles}{" "}
                        с риском
                      </span>
                      <em className={`dispatch-queue-state ${item.status}`}>
                        {statusLabel}
                      </em>
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="dispatch-queue-empty">
                По этому фильтру маршрутов нет. Измените запрос или выберите
                «Все».
              </p>
            )}
          </div>
          <p className="dispatch-queue-note">
            Сначала маршруты со срочными и серьёзными решениями. Подсказки
            сформированы правилами.
          </p>
        </aside>
        <div className="dispatch-planner-anchor">
          <div className="dispatch-context">
            <label>
              Маршрут для управления
              <select
                aria-label="Маршрут для управления"
                value={route.id}
                onChange={(e) => focusRoute(e.target.value)}
              >
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number} · {r.name}
                  </option>
                ))}
              </select>
            </label>
            <RouteBadge number={route.number} risk={route.riskLevel} />
            <span>{vehicles.filter((v) => v.routeId === route.id).length} на линии</span>
          </div>
          <DecisionFeed
            routeNumber={route.number}
            decisions={decisions}
            selectedId={decision?.id}
            onSelect={(id) => {
              setDecisionId(id);
              decisionSubmit.setError("");
            }}
            onApply={(d) => void applyDecision(d)}
            onPrefill={prefillDecision}
            applyLabel={
              config.dispatchApi
                ? canApply
                  ? "Отправить решение по API"
                  : "Сохранить решение по API"
                : canApply
                  ? "Применить решение"
                  : "Сохранить решение в плане"
            }
            applyDisabled={decisionBlocked}
            busy={decisionSubmit.busy}
            error={decisionSubmit.error}
            status={recommendation?.status || "unavailable"}
            statusText={
              recommendation?.status === "active"
                ? "Решение по маршруту уже применено. Проверьте автобусы ниже или отмените его в журнале."
                : recommendation?.reasons.join(" ") ||
                  "Нет свежих данных для подсказок."
            }
          />
          <VehicleBoard
            key={route.id}
            route={route}
            vehicles={vehicles}
            contact={contact}
            onCloseContact={() => setContact(null)}
          />
          <GigachatPanel
            route={route}
            vehicles={vehicles}
            reserve={canApply ? reserveRemaining(plans) : 0}
            onContact={setContact}
            onReserve={() => {
              const extra = decisions.find((item) => item.kind === "add_bus");
              if (extra) prefillDecision(extra);
              else if (recommendation && canApply && reserveRemaining(plans) > 0)
                choose({ ...recommendation, status: "suggested", targetFleet: route.activeVehicleCount + 1 });
              else plannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
          <div ref={plannerRef} className="dispatch-manual">
            <div className="dispatch-manual-heading">
              <span className="dispatch-eyebrow">РУЧНАЯ НАСТРОЙКА</span>
              <p>
                Своя комбинация выпуска и стоянки для маршрута. «Подставить»
                переносит сюда подсказку без применения.
              </p>
            </div>
            <Planner
              key={`${route.id}-${prepared?.version || 0}`}
              route={route}
              canApply={canApply}
              online={online}
              onNotice={setNotice}
              recommendation={recommendation}
              settings={settings}
              initialRecommendation={
                prepared?.item.routeId === route.id ? prepared.item : undefined
              }
            />
          </div>
        </div>
      </div>
      {notice && (
        <p className="dispatch-notice" role="status">
          <Check size={16} />
          {notice}
        </p>
      )}
      {networkOpen && <NetworkScenariosDrawer
        routes={routes}
        items={recommendations}
        onClose={() => setNetworkOpen(false)}
        onOpenAdvice={(id) => {
          focusRoute(id);
          setNetworkOpen(false);
          requestAnimationFrame(() => document.querySelector(".gigachat-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }));
        }}
        onPrepare={(item) => { choose(item); setNetworkOpen(false); }}
      />}
      <div className="dispatch-journal">
        <div className="row-between">
          <h3>
            <ClipboardList size={18} /> Журнал решений
          </h3>
          <span>{active.length} активных сценариев</span>
        </div>
        {!plans.length ? (
          <p className="muted">
            Сохранённые планы и применённые демосценарии появятся здесь.
          </p>
        ) : (
          <div className="dispatch-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Маршрут / время</th>
                  <th>Автобусы</th>
                  <th>Стоянка</th>
                  <th>Статус</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>№ {p.routeNumber}</strong>
                      <small>
                        {new Date(p.createdAt).toLocaleString("ru-RU")}
                      </small>
                      {p.decisionKind && p.decisionKind in decisionKindLabel && (
                        <small className="journal-kind">
                          {
                            decisionKindLabel[
                              p.decisionKind as keyof typeof decisionKindLabel
                            ]
                          }
                        </small>
                      )}
                    </td>
                    <td>
                      {p.baseFleet} → {p.targetFleet}
                    </td>
                    <td>
                      {p.baseDwellSec} → {p.targetDwellSec} с
                      <small>
                        {p.vehicleId ? `${busLabel(p.vehicleId)} · ` : ""}
                        {p.stopName}
                        {p.dwellStops && p.dwellStops > 1
                          ? ` и ещё ${p.dwellStops - 1} ост.`
                          : ""}
                      </small>
                    </td>
                    <td>
                      <span className={`dispatch-status ${p.status}`}>
                        {
                          {
                            active: config.dispatchApi
                              ? "Применён через API (демо)"
                              : "Применён в демо",
                            draft: "План",
                            cancelled: "Отменён",
                            replaced: "Заменён",
                          }[p.status]
                        }
                      </span>
                    </td>
                    <td>
                      {p.status === "active" || p.status === "draft" ? (
                        <button
                          className="text-button"
                          onClick={() => void undo(p.id)}
                        >
                          <RotateCcw size={13} />
                          Отменить
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="dispatch-footnote">
          {config.dispatchApi
            ? "Серверный журнал."
            : "Журнал хранится в этом браузере. Реальные команды в диспетчерскую систему не отправляются."}
        </p>
      </div>
    </section>
  );
}
function Planner({
  route,
  canApply,
  online,
  onNotice,
  recommendation,
  initialRecommendation,
  settings,
}: {
  route: Route;
  canApply: boolean;
  online: boolean;
  onNotice: (s: string) => void;
  recommendation?: DispatchRecommendation;
  initialRecommendation?: DispatchRecommendation;
  settings: DispatchSettings;
}) {
  const navigate = useNavigate();
  const local = useDispatch();
  const api = useApiDispatch();
  const plans = config.dispatchApi
    ? api.commands.data?.commands.map((c) => c.plan) || []
    : local.plans;
  const { submit, busy, error, setError, apiUnavailable } =
    usePlanSubmit(onNotice);
  const active = plans.find(
    (p) => p.status === "active" && p.routeId === route.id,
  );
  const baseFleet = active?.baseFleet || route.activeVehicleCount;
  const [fleet, setFleet] = useState(
    initialRecommendation?.targetFleet ?? active?.targetFleet ?? baseFleet,
  );
  const [cycle, setCycle] = useState(
    initialRecommendation?.cycleMin ?? active?.cycleMin ?? settings.cycleMin,
  );
  const [stopId, setStopId] = useState(
    initialRecommendation?.stopId ||
      useUi.getState().selectedStopId ||
      active?.stopId ||
      route.stops[0]?.id ||
      "",
  );
  const [before, setBefore] = useState(
    initialRecommendation?.currentDwellSec ??
      active?.baseDwellSec ??
      settings.baseDwellSec,
  );
  const [after, setAfter] = useState(
    initialRecommendation?.targetDwellSec ??
      active?.targetDwellSec ??
      settings.baseDwellSec,
  );
  const [target, setTarget] = useState<Target>(() =>
    targetOf(initialRecommendation ?? active),
  );
  const stop = route.stops.find((s) => s.id === stopId) || route.stops[0];
  const draft: DispatchPlan = {
    id: "preview",
    routeId: route.id,
    routeNumber: route.number,
    baseFleet,
    targetFleet: fleet,
    cycleMin: cycle,
    stopId: stop?.id || "",
    stopName: stop?.name || "",
    baseDwellSec: before,
    targetDwellSec: after,
    createdAt: "",
    status: "draft",
    ...target,
  };
  let result: ReturnType<typeof evaluatePlan> | undefined,
    invalid = "";
  try {
    result = evaluatePlan(draft);
    if (!stop) invalid = "Нет остановок для управления.";
  } catch (e) {
    invalid = (e as Error).message;
  }
  const remaining = result ? reserveRemaining(plans, draft) : 0;
  const changed = active
    ? fleet !== active.targetFleet ||
      cycle !== active.cycleMin ||
      stopId !== active.stopId ||
      before !== active.baseDwellSec ||
      after !== active.targetDwellSec ||
      target.vehicleId !== active.vehicleId
    : fleet !== baseFleet || before !== after;
  const resetForm = () => {
    setFleet(active?.targetFleet ?? baseFleet);
    setCycle(active?.cycleMin ?? settings.cycleMin);
    setStopId(active?.stopId ?? route.stops[0]?.id ?? "");
    setBefore(active?.baseDwellSec ?? settings.baseDwellSec);
    setAfter(active?.targetDwellSec ?? settings.baseDwellSec);
    setTarget(targetOf(active));
    setError("");
  };
  const takeDwell = () => {
    if (
      !recommendation?.stopId ||
      recommendation.targetDwellSec === null ||
      recommendation.currentDwellSec === null
    )
      return;
    setStopId(recommendation.stopId);
    setBefore(recommendation.currentDwellSec);
    setAfter(recommendation.targetDwellSec);
    setTarget(targetOf(recommendation));
  };
  const takeAll = () => {
    if (recommendation?.status !== "suggested") return;
    setFleet(recommendation.targetFleet);
    if (recommendation.cycleMin !== null) setCycle(recommendation.cycleMin);
    takeDwell();
    onNotice(
      "Подсказки подставлены в форму. Проверьте план перед применением.",
    );
  };
  const commit = async (activate: boolean) => {
    setError("");
    if (invalid || !changed) {
      setError(invalid || "Измените выпуск или время стоянки.");
      return;
    }
    if (activate && !online) {
      setError(
        "Поток недоступен. Дождитесь свежих данных или сохраните только план.",
      );
      return;
    }
    await submit(draft, activate);
  };
  return (
    <>
      {recommendation && (
        <div className="recommend-selected">
          <RouteIcon size={22} />
          <div>
            <strong>Подсказка для маршрута {route.number}</strong>
            <p>{recommendation.reasons.join(" ")}</p>
            <small>
              Правила демосценария · ожидаемый эффект на задержку ещё не
              рассчитан ML-моделью
            </small>
          </div>
          <button
            className="primary-button"
            onClick={takeAll}
            disabled={recommendation.status !== "suggested"}
          >
            Подставить подсказки
          </button>
        </div>
      )}
      <div className="dispatch-grid">
        <section className="dispatch-card">
          <div className="dispatch-card-title">
            <span className="dispatch-icon blue">
              <BusFront size={22} />
            </span>
            <div>
              <span>01 / ВЫПУСК</span>
              <h3>Автобусы на линии</h3>
            </div>
          </div>
          <p>Оцените интервал после изменения выпуска со следующего оборота.</p>
          <label className="dispatch-field">
            Плановое количество
            <div className="fleet-stepper">
              <button
                aria-label="Уменьшить выпуск"
                disabled={fleet <= 1}
                onClick={() => setFleet(fleet - 1)}
              >
                −
              </button>
              <input
                aria-label="Плановое количество автобусов"
                type="number"
                min="1"
                max="500"
                value={fleet}
                onChange={(e) => setFleet(e.target.valueAsNumber)}
              />
              <button
                aria-label="Увеличить выпуск"
                onClick={() => setFleet(fleet + 1)}
              >
                +
              </button>
            </div>
          </label>
          {recommendation && (
            <div className="recommend-inline">
              <span>Сейчас → подсказка</span>
              <RecommendationValue
                before={recommendation.currentFleet}
                after={recommendation.targetFleet}
              />
              <button
                className="text-button"
                disabled={
                  recommendation.status !== "suggested" ||
                  recommendation.currentFleet === recommendation.targetFleet
                }
                onClick={() => setFleet(recommendation.targetFleet)}
              >
                Взять выпуск
              </button>
            </div>
          )}
          <div className="fleet-visual" aria-hidden="true">
            {Array.from(
              {
                length: Math.min(
                  12,
                  Number.isFinite(fleet) ? Math.max(0, fleet) : 0,
                ),
              },
              (_, i) => (
                <BusFront
                  key={i}
                  size={27}
                  className={i >= baseFleet ? "added" : ""}
                />
              ),
            )}
            {fleet > 12 && <span>+{fleet - 12}</span>}
          </div>
          <label className="dispatch-field">
            Время полного оборота, мин
            <input
              aria-label="Время оборота"
              type="number"
              min="10"
              max="360"
              value={cycle}
              onChange={(e) => setCycle(e.target.valueAsNumber)}
            />
          </label>
        </section>
        <section className="dispatch-card">
          <div className="dispatch-card-title">
            <span className="dispatch-icon amber">
              <Clock3 size={22} />
            </span>
            <div>
              <span>02 / ОСТАНОВКИ</span>
              <h3>Время стоянки</h3>
            </div>
          </div>
          <p>
            Сократите лишнюю стоянку или добавьте удержание для выравнивания
            интервала.
          </p>
          <label className="dispatch-field">
            Остановка
            <select
              aria-label="Остановка для стоянки"
              value={stop?.id || ""}
              onChange={(e) => {
                setStopId(e.target.value);
                // A different stop is a manual plan for every bus, not the suggested one.
                setTarget({});
              }}
            >
              {route.stops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.sequence}. {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="dwell-inputs">
            <label className="dispatch-field">
              Исходная, с
              <input
                aria-label="Исходная стоянка"
                type="number"
                min="5"
                max="300"
                value={before}
                onChange={(e) => setBefore(e.target.valueAsNumber)}
              />
            </label>
            <ArrowRight size={18} />
            <label className="dispatch-field">
              По сценарию, с
              <input
                aria-label="Плановая стоянка"
                type="number"
                min="5"
                max="300"
                value={after}
                onChange={(e) => setAfter(e.target.valueAsNumber)}
              />
            </label>
          </div>
          {recommendation && (
            <div className="recommend-inline">
              <span>Стоянка → подсказка</span>
              <RecommendationValue
                before={recommendation.currentDwellSec}
                after={recommendation.targetDwellSec}
                unit=" с"
              />
              <button
                className="text-button"
                disabled={
                  recommendation.status !== "suggested" ||
                  recommendation.currentDwellSec ===
                    recommendation.targetDwellSec
                }
                onClick={takeDwell}
              >
                Взять стоянку
              </button>
              <small>
                {recommendation.stopName || "Нужны данные о стоянке"}
              </small>
            </div>
          )}
          <div className="dwell-presets">
            {[15, 30, 60, 90].map((n) => (
              <button
                key={n}
                className={n === after ? "selected" : ""}
                onClick={() => setAfter(n)}
              >
                {n} с
              </button>
            ))}
          </div>
        </section>
        <section className="dispatch-card dispatch-preview">
          <div className="dispatch-card-title">
            <span className="dispatch-icon green">
              <SlidersHorizontal size={22} />
            </span>
            <div>
              <span>03 / ОЦЕНКА</span>
              <h3>Что изменится</h3>
            </div>
          </div>
          <span className="dispatch-simulation-label">
            РАСЧЁТ СЦЕНАРИЯ · НЕ ML-ПРОГНОЗ
          </span>
          {target.vehicleId && (
            <p className="dispatch-target">
              Только для {busLabel(target.vehicleId)}
              {target.dwellStops && target.dwellStops > 1
                ? ` · на ${target.dwellStops} остановках подряд`
                : ""}
            </p>
          )}
          {result ? (
            <>
              <div className="dispatch-comparison">
                <span>Автобусы на линии</span>
                <strong>
                  {baseFleet}
                  <ArrowRight size={16} />
                  {fleet}
                </strong>
              </div>
              <div className="dispatch-comparison">
                <span>Равномерный интервал</span>
                <strong>
                  {duration(result.headwayBefore)}
                  <ArrowRight size={16} />
                  {duration(result.headwayAfter)}
                </strong>
              </div>
              <div className="dispatch-comparison">
                <span>Стоянка на остановке</span>
                <strong>
                  {before} с<ArrowRight size={16} />
                  {after} с
                </strong>
              </div>
              <div className="dispatch-impact">
                <span>
                  {result.dwellDelta < 0
                    ? "Сокращение времени на прохождение"
                    : result.dwellDelta > 0
                      ? "Дополнительное удержание"
                      : "Время прохождения без изменений"}
                </span>
                <strong>
                  {result.dwellDelta > 0 ? "+" : ""}
                  {result.dwellDelta} <small>с / автобус</small>
                </strong>
              </div>
            </>
          ) : (
            <p role="alert">{invalid}</p>
          )}
          {canApply && remaining < 0 && (
            <p className="dispatch-error" role="alert">
              Не хватает {Math.abs(remaining)} автобусов в деморезерве.
            </p>
          )}
          {canApply && !online && (
            <p className="dispatch-error" role="alert">
              Поток недоступен. Можно сохранить только план.
            </p>
          )}
          <button
            className="primary-button"
            disabled={
              busy ||
              apiUnavailable ||
              !!invalid ||
              !changed ||
              (canApply && (remaining < 0 || !online))
            }
            onClick={() => void commit(canApply)}
          >
            {config.officialMode
              ? "Сохранить план по API"
              : config.dispatchApi
                ? "Отправить по API"
                : canApply
                  ? "Применить в демо"
                  : "Сохранить план"}
            <Check size={15} />
          </button>
          {canApply && (
            <button
              className="dispatch-secondary"
              disabled={busy || apiUnavailable || !!invalid || !changed}
              onClick={() => void commit(false)}
            >
              Сохранить только план
            </button>
          )}
          {changed && (
            <button className="text-button" onClick={resetForm}>
              <RotateCcw size={14} />
              Сбросить правки
            </button>
          )}
          <button
            className="text-button"
            onClick={() => {
              useUi.getState().selectRoute(route.id);
              navigate("/overview");
            }}
          >
            <MapPin size={14} />
            Открыть маршрут на карте
          </button>
          {error && (
            <p className="dispatch-error" role="alert">
              {error}
            </p>
          )}
          {canApply && <small>
            Действует только в демонстрации. Можно отменить в журнале. Резервные автобусы показаны на начальной остановке.
          </small>}
        </section>
      </div>
    </>
  );
}
