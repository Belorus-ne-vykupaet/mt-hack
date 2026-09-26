import { useEffect, useState } from "react";
import { ArrowRight, Bot, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { integrationRequest } from "../../shared/api/integrations";
import { busLabel } from "../../entities/dispatch-decisions";
import type { DispatchAdvice } from "../../entities/dispatch-advice";
import type { Route, Vehicle } from "../../entities/models";
import { config } from "../../shared/config/env";
import type { ContactKind, ContactTarget } from "./VehicleBoard";

type AdvisorStatus = { configured: boolean; model?: string };

export function GigachatPanel({ route, onContact, onReserve }: {
  route: Route;
  vehicles: Vehicle[];
  reserve: number;
  onContact: (target: ContactTarget) => void;
  onReserve: () => void;
}) {
  const [adviceByRoute, setAdviceByRoute] = useState<Record<string, DispatchAdvice>>({});
  const [status, setStatus] = useState<AdvisorStatus | null>(null);
  const [loadingRoute, setLoadingRoute] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const routeId = route.id;
  const shown = adviceByRoute[routeId]?.source === "gigachat" ? adviceByRoute[routeId] : null;
  const loading = loadingRoute === routeId;
  const error = errors[routeId] || "";

  const analyze = async (id: string, refresh = false) => {
    setLoadingRoute(id);
    setErrors((previous) => ({ ...previous, [id]: "" }));
    try {
      const result = await integrationRequest<DispatchAdvice>("/dispatch/advice", {
        method: "POST", body: JSON.stringify({ routeId: id, refresh }), signal: AbortSignal.timeout(40000),
      });
      if (result.source !== "gigachat") throw new Error("GigaChat не вернул рекомендации.");
      setAdviceByRoute((previous) => ({ ...previous, [id]: result }));
    } catch (cause) {
      setErrors((previous) => ({ ...previous, [id]: (cause as Error).message }));
    } finally {
      setLoadingRoute((current) => current === id ? "" : current);
    }
  };

  useEffect(() => {
    if (config.dataSource === "mock") { setStatus({ configured: false }); return; }
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    integrationRequest<AdvisorStatus>(`/dispatch/advice?route_id=${encodeURIComponent(routeId)}`)
      .then((value) => {
        if (!alive) return;
        setStatus(value);
        if (!value.configured) return;
        void analyze(routeId);
        timer = setInterval(() => {
          if (document.visibilityState === "visible") void analyze(routeId);
        }, 120_000);
      })
      .catch((cause) => { if (alive) setErrors((previous) => ({ ...previous, [routeId]: (cause as Error).message })); });
    return () => { alive = false; if (timer) clearInterval(timer); };
    // The selected route alone starts a new analysis; telemetry updates do not trigger model requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  return <section className="gigachat-panel" aria-label="Советник GigaChat">
    <div className="gigachat-heading">
      <span className="gigachat-mark"><Bot size={22}/></span>
      <div><span className="dispatch-eyebrow">GIGACHAT · ПО ВЫБРАННОМУ МАРШРУТУ</span><h3>Рекомендации для диспетчера</h3></div>
      <span className="gigachat-source gigachat">{status?.configured ? status.model || "GigaChat" : "Не подключён"}</span>
    </div>
    {shown && <>
      <p className="gigachat-summary">{shown.summary}</p>
      <div className="gigachat-cards">{shown.cards.map((card, index) => <article key={`${card.kind}-${card.vehicleId}-${index}`}>
        <div className="gigachat-card-top"><span>{String(index + 1).padStart(2, "0")}</span><strong>{card.title}</strong></div>
        <p>{card.reason}</p>
        {card.vehicleId && <small>{busLabel(card.vehicleId)}</small>}
        {card.kind === "reserve"
          ? <button onClick={onReserve}>Открыть план выпуска <ArrowRight size={14}/></button>
          : card.vehicleId && <button onClick={() => onContact({ vehicleId: card.vehicleId!, kind: card.kind as ContactKind, message: card.message || undefined })}>Открыть команду водителю <ArrowRight size={14}/></button>}
      </article>)}
      {!shown.cards.length && <p className="gigachat-empty">Сейчас GigaChat не предложил действие для этого маршрута.</p>}</div>
    </>}
    {!shown && !loading && !error && <p className="gigachat-empty">{status?.configured === false ? "GigaChat не подключён. Рекомендации появятся после настройки ключа на сервере." : "Анализируем маршрут…"}</p>}
    {loading && <p className="gigachat-empty" role="status">Обновляем рекомендации по маршруту {route.number}…</p>}
    {error && <p className="dispatch-error" role="alert">{error}</p>}
    <div className="gigachat-footer">
      <p>{shown ? `Обновлено ${new Date(shown.generatedAt).toLocaleTimeString("ru-RU")}. Проверьте рекомендацию перед отправкой.` : "Рекомендации основаны на телеметрии и прогнозе выбранного маршрута."}</p>
      <button disabled={!status?.configured || loading} onClick={() => void analyze(routeId, true)}><RefreshCw size={15}/>{loading ? "Обновляем…" : "Обновить"}</button>
    </div>
    <Link className="gigachat-reports-link" to="/reports">Отчёты по дням <ArrowRight size={14}/></Link>
  </section>;
}
