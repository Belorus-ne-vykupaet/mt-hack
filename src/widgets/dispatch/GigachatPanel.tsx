import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bot, RefreshCw, Sparkles } from "lucide-react";
import { integrationRequest } from "../../shared/api/integrations";
import { busLabel } from "../../entities/dispatch-decisions";
import { ruleAdvice } from "../../entities/dispatch-advice";
import type { DispatchAdvice } from "../../entities/dispatch-advice";
import type { Route, Vehicle } from "../../entities/models";
import { config } from "../../shared/config/env";
import type { ContactKind, ContactTarget } from "./VehicleBoard";
export function GigachatPanel({ route, vehicles, reserve, onContact, onReserve }: {
  route: Route;
  vehicles: Vehicle[];
  reserve: number;
  onContact: (target: ContactTarget) => void;
  onReserve: () => void;
}) {
  const [adviceByRoute, setAdviceByRoute] = useState<Record<string, DispatchAdvice>>({});
  const [loadingRoute, setLoadingRoute] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const routeId = route.id;
  const stored = adviceByRoute[routeId];
  const localAdvice = useMemo(() => ruleAdvice(
    route, vehicles.filter((v) => v.routeId === route.id), reserve,
    config.dataSource === "api" && !!stored?.configured,
    stored?.note.startsWith("GigaChat недоступен") ? stored.note : config.dataSource === "mock"
      ? "Демо-подсказки по правилам. Для GigaChat подключите сайт к API и задайте серверный ключ."
      : "Подсказки пересчитываются по текущим данным. GigaChat вызывается только по кнопке.",
  ), [route, vehicles, reserve, stored]);
  const modelAdvice = stored?.source === "gigachat" ? stored : null;
  const shown = modelAdvice || localAdvice;
  const error = errors[routeId] || "";
  const loading = loadingRoute === routeId;
  useEffect(() => {
    if (config.dataSource === "mock") return;
    let alive = true;
    integrationRequest<DispatchAdvice>(`/dispatch/advice?route_id=${encodeURIComponent(routeId)}`)
      .then((value) => { if (alive) setAdviceByRoute((previous) => ({ ...previous, [routeId]: value })); })
      .catch((cause) => { if (alive) setErrors((previous) => ({ ...previous, [routeId]: (cause as Error).message })); });
    return () => { alive = false; };
  }, [routeId]);
  const analyze = async () => {
    setLoadingRoute(routeId);
    setErrors((previous) => ({ ...previous, [routeId]: "" }));
    try {
      const result = await integrationRequest<DispatchAdvice>("/dispatch/advice", {
        method: "POST", body: JSON.stringify({ routeId }), signal: AbortSignal.timeout(40000),
      });
      setAdviceByRoute((previous) => ({ ...previous, [routeId]: result }));
    } catch (cause) { setErrors((previous) => ({ ...previous, [routeId]: (cause as Error).message })); }
    finally { setLoadingRoute((current) => current === routeId ? "" : current); }
  };
  return <section className="gigachat-panel" aria-label="Советник GigaChat">
    <div className="gigachat-heading"><span className="gigachat-mark"><Bot size={22}/></span><div><span className="dispatch-eyebrow">ПОМОЩНИК ДИСПЕТЧЕРА</span><h3>Предложения по маршруту</h3></div><span className={`gigachat-source ${shown?.source || "rules"}`}>{shown?.source === "gigachat" ? "GigaChat" : "Правила"}</span></div>
    {shown ? <>
      <p className="gigachat-summary">{shown.summary}</p>
      <div className="gigachat-cards">{shown.cards.map((card, index) => <article key={`${card.kind}-${card.vehicleId}-${index}`}>
        <div className="gigachat-card-top"><span>{String(index + 1).padStart(2, "0")}</span><strong>{card.title}</strong></div>
        <p>{card.reason}</p>
        {card.vehicleId && <small>{busLabel(card.vehicleId)}</small>}
        {card.kind === "reserve"
          ? <button onClick={onReserve}>Открыть план выпуска <ArrowRight size={14}/></button>
          : card.vehicleId && <button onClick={() => onContact({ vehicleId: card.vehicleId!, kind: card.kind as ContactKind, message: card.kind === "message" ? card.message || undefined : undefined })}>Подготовить для водителя <ArrowRight size={14}/></button>}
      </article>)}
      {!shown.cards.length && <p className="gigachat-empty">Недостаточно данных для конкретного действия.</p>}</div>
      <div className="gigachat-footer"><p>{shown.note} При запросе GigaChat сводка архивного маршрута и доступная текущая погода передаются внешнему сервису отдельно. Сегодняшняя погода не объясняет задержки в архиве.</p><button disabled={!shown.configured || loading} onClick={() => void analyze()}><Sparkles size={15}/>{loading ? "Анализируем…" : "Спросить GigaChat"}</button></div>
      {!shown.configured && <small className="gigachat-key-note">Для включения задайте <code>GIGACHAT_AUTH_KEY</code> в <code>server/.env</code> и перезапустите сервер.</small>}
    </> : <p className="gigachat-empty">{error || "Собираем данные маршрута…"}</p>}
    {error && shown && <p className="dispatch-error" role="alert">{error}</p>}
    {shown?.source === "gigachat" && <small className="gigachat-generated"><RefreshCw size={12}/> Обновлено {new Date(shown.generatedAt).toLocaleTimeString("ru-RU")}</small>}
  </section>;
}
