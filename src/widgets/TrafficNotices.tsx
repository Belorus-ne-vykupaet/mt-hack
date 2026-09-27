import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert, ArrowUpRight, Route as RoadIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUi } from "../app/store";
import { config } from "../shared/config/env";
import { integrationRequest } from "../shared/api/integrations";
import { roadEventTitle, type RoadMonitorState } from "../entities/road-events";
import type { Vehicle } from "../entities/models";
import "../styles/traffic-notices.css";
const key = ["road-notifications"];

export function TrafficNotices({vehicles = [], compact = false}: {vehicles?: Vehicle[]; compact?: boolean}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [selected, setSelected] = useState("");
  const query = useQuery({queryKey: key, queryFn: () => integrationRequest<RoadMonitorState>("/traffic/notifications"),
    enabled: config.dataSource === "api", refetchInterval: 5000, retry: false});
  const demo = useMutation({mutationFn: (body: {vehicleId?: string; clear?: boolean}) =>
    integrationRequest<RoadMonitorState>("/traffic/demo", {method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(45000)}),
    onSuccess: data => client.setQueryData(key, data)});
  const data = query.data;
  const candidates = vehicles.filter(v => !v.telemetryStale && v.nextStop);
  const vehicleId = candidates.some(v => v.id === selected) ? selected : candidates[0]?.id || "";
  if (config.dataSource !== "api" || !data ||
    (!data.configured && !data.items.length && !config.visualTest) ||
    (compact && !data.items.length)) return null;
  return <section className={`traffic-notices ${compact ? "compact" : ""}`} aria-label="Дорожные события">
    <header><RoadIcon size={18}/><div><h3>Дорожные события</h3>
      {!compact && <small>{data?.configured ? "Обстановка впереди автобусов" : "Живой источник не подключён · доступна демонстрация"}</small>}</div>
      {!!data?.items.length && <span className="count">{data.items.length}</span>}
    </header>
    {!compact && config.visualTest && <div className="traffic-demo-controls">
      <select aria-label="Автобус для тестового ДТП" value={vehicleId} onChange={e => setSelected(e.target.value)}>
        {candidates.map(v => <option key={v.id} value={v.id}>ТС {v.id.replace("vehicle-", "")}</option>)}
      </select>
      <button className="secondary-button" disabled={!vehicleId || demo.isPending} onClick={() => demo.mutate({vehicleId})}>
        {demo.isPending ? "Обработка…" : "Тестовое ДТП"}
      </button>
      {data?.items.some(n => n.event.source === "demo") && <button className="text-button" disabled={demo.isPending}
        onClick={() => demo.mutate({clear: true})}>Убрать тест</button>}
    </div>}
    {(query.isError || demo.isError || data?.status === "unavailable") && <p className="traffic-error" role="status">
      {demo.error?.message || "Дорожные данные сейчас недоступны. Повторите позже."}
    </p>}
    <div aria-live="polite" aria-relevant="additions text">
      {data?.items.map(notice => <article key={notice.id} className="traffic-notice">
        <div className="traffic-notice-heading"><TriangleAlert size={17}/><strong>{roadEventTitle[notice.event.kind]}</strong>
          <span>{notice.event.source === "demo" ? "Тестовое событие" : notice.event.source === "yandex-router" ? "Яндекс" : "Дорожный источник"}</span></div>
        <p className="traffic-notice-location">ТС {notice.vehicleId.replace("vehicle-", "")} · {notice.distanceM} м впереди</p>
        <strong className="traffic-indefinite">Задержка не определена</strong>
        <p>{notice.event.description}</p>
        {notice.analysisStatus === "ready" ? <div className="traffic-analysis"><small>GigaChat</small><p>{notice.analysis}</p><p>{notice.recommendation}</p></div>
          : <p className="traffic-analysis-status">{notice.analysisStatus === "pending" ? "GigaChat анализирует событие…" : "Анализ GigaChat недоступен. Уточните обстановку у водителя."}</p>}
        <footer><time dateTime={notice.observedAt}>{new Date(notice.observedAt).toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"})}</time>
          <button className="text-button" onClick={() => { useUi.getState().selectVehicle(notice.vehicleId, notice.routeId); navigate("/overview"); }}>На карте <ArrowUpRight size={13}/></button></footer>
      </article>)}
    </div>
    {!compact && data?.configured && !data.items.length && !query.isError && data.status !== "unavailable" && <p className="traffic-empty">
      {data.status === "checking" || !data.checkedAt ? "Проверяем участки впереди автобусов…" : "На проверенных участках событий не обнаружено."}
    </p>}
  </section>;
}
