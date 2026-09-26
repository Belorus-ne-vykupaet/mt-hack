import { useEffect, useMemo, useRef, useState } from "react";
import { BusFront, Clock3, Gauge, MessageSquareText, Save, Timer, X } from "lucide-react";
import type { Route, Vehicle } from "../../entities/models";
import { busLabel } from "../../entities/dispatch-decisions";
import { integrationRequest } from "../../shared/api/integrations";
import { config } from "../../shared/config/env";

export type ContactKind = "message" | "speed" | "dwell";
export interface ContactTarget { vehicleId: string; kind: ContactKind; message?: string }
interface Draft {
  id: string; routeId: string; vehicleId: string; kind: ContactKind; text: string;
  createdAt: string; status: "draft";
}
const LOCAL_DRAFTS = "transit-driver-drafts-v1";
const savedLocal = (): Draft[] => {
  try { const value = JSON.parse(localStorage.getItem(LOCAL_DRAFTS) || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
};
const delay = (sec: number) => {
  const abs = Math.abs(sec);
  return `${sec < 0 ? "−" : "+"}${Math.floor(abs / 60)}:${String(Math.round(abs % 60)).padStart(2, "0")}`;
};
const forecastable = (v: Vehicle) => v.hasForecast !== false && !["no_schedule", "no_target", "stale_gps", "unavailable"].includes(v.forecastStatus || "") && Number.isFinite(v.predictedDelaySec);

export function VehicleBoard({ route, vehicles, contact, onCloseContact }: {
  route: Route;
  vehicles: Vehicle[];
  contact: ContactTarget | null;
  onCloseContact: () => void;
}) {
  const fleet = useMemo(() => vehicles.filter((v) => v.routeId === route.id)
    .sort((a, b) => (forecastable(b) ? b.predictedDelaySec : -Infinity) - (forecastable(a) ? a.predictedDelaySec : -Infinity)), [vehicles, route.id]);
  const [ownContact, setOwnContact] = useState<ContactTarget | null>(null);
  const active = contact || ownContact;
  const vehicle = fleet.find((v) => v.id === active?.vehicleId);
  const [drafts, setDrafts] = useState<Draft[]>(() => config.dataSource === "mock"
    ? savedLocal().filter((item) => item.routeId === route.id).slice(0, 50)
    : []);
  const [saved, setSaved] = useState("");
  useEffect(() => {
    if (config.dataSource === "mock") return;
    let alive = true;
    integrationRequest<{ items: Draft[] }>(`/dispatch/driver-messages?route_id=${encodeURIComponent(route.id)}`)
      .then((data) => { if (alive) setDrafts(data.items); })
      .catch(() => { if (alive) setDrafts([]); });
    return () => { alive = false; };
  }, [route.id]);
  const open = (vehicleId: string, kind: ContactKind) => {
    onCloseContact();
    setSaved("");
    setOwnContact({ vehicleId, kind });
  };
  const close = () => { setOwnContact(null); onCloseContact(); };
  const known = fleet.filter(forecastable).length;
  return <section className="vehicle-board" aria-label={`Автобусы маршрута ${route.number}`}>
    <header className="vehicle-board-heading">
      <div><span className="dispatch-eyebrow">ПО КАЖДОМУ АВТОБУСУ</span><h3>Автобусы маршрута {route.number}</h3>
        <p>Текущее отклонение и прогноз к целевой остановке. «—» означает, что данных для оценки нет.</p></div>
      <span className="vehicle-board-count"><BusFront size={16}/>{fleet.length} на линии · {known} с прогнозом</span>
    </header>
    <div className="vehicle-board-labels"><span>Автобус / следующая остановка</span><span>Сейчас</span><span>Прогноз</span><span>Связь с водителем</span></div>
    <div className="vehicle-board-list">
      {fleet.map((v) => <article className="vehicle-board-row" key={v.id}>
        <div className="vehicle-board-identity"><span className={`vehicle-board-icon risk-${v.riskLevel}`}><BusFront size={19}/></span>
          <div><strong>{busLabel(v.id)}</strong><small>{v.nextStop?.name || "Остановка не определена"}</small></div></div>
        <div className="vehicle-board-value"><small>Сейчас</small><strong>{v.currentDelayKnown === false ? "—" : delay(v.currentDelaySec)}</strong></div>
        <div className={`vehicle-board-value ${forecastable(v) ? `risk-${v.riskLevel}` : "unknown"}`}><small>Прогноз {v.forecastHorizonSec ? `+${Math.round(v.forecastHorizonSec / 60)} мин` : ""}</small><strong>{forecastable(v) ? delay(v.predictedDelaySec) : "—"}</strong></div>
        <div className="vehicle-board-actions">
          <button title={`Написать ${busLabel(v.id)}`} onClick={() => open(v.id, "message")}><MessageSquareText size={15}/><span>Написать</span></button>
          <button title={`Рекомендовать скорость ${busLabel(v.id)}`} onClick={() => open(v.id, "speed")}><Gauge size={15}/><span>Скорость</span></button>
          <button title={`Указать стоянку ${busLabel(v.id)}`} onClick={() => open(v.id, "dwell")}><Timer size={15}/><span>Стоянка</span></button>
        </div>
      </article>)}
      {!fleet.length && <p className="vehicle-board-empty">На выбранном маршруте сейчас нет автобусов в потоке.</p>}
    </div>
    {vehicle && active && <DriverComposer
      key={`${active.vehicleId}-${active.kind}-${active.message || ""}`}
      route={route} vehicle={vehicle} contact={active} onClose={close}
      onSaved={(item) => {
        setDrafts((prev) => [item, ...prev].slice(0, 50));
        setSaved(config.dataSource === "mock" ? "Черновик сохранён в этом браузере. Водителю он не отправлен." : "Черновик сохранён в журнале. Водителю он не отправлен.");
        close();
      }}
    />}
    {saved && <p className="dispatch-notice" role="status">{saved}</p>}
    {drafts.length > 0 && <details className="driver-drafts"><summary><Clock3 size={15}/> Журнал сообщений · {drafts.length} черновиков</summary><ul>{drafts.slice(0, 10).map((draft) => <li key={draft.id}><strong>{busLabel(draft.vehicleId)}</strong><span>{draft.text}</span><small>{new Date(draft.createdAt).toLocaleString("ru-RU")} · не отправлено</small></li>)}</ul></details>}
  </section>;
}

function DriverComposer({ route, vehicle, contact, onClose, onSaved }: {
  route: Route;
  vehicle: Vehicle;
  contact: ContactTarget;
  onClose: () => void;
  onSaved: (item: Draft) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(() => contact.message?.slice(0, 250) || (contact.kind === "message"
    ? `Маршрут ${route.number}, ${busLabel(vehicle.id)}: сообщите обстановку у ${vehicle.nextStop?.name || "следующей остановки"}. Соблюдайте график и ПДД.`
    : ""));
  const [speed, setSpeed] = useState(() => Math.min(60, Math.max(5, Math.round(vehicle.speedKmh || 30))));
  const [dwell, setDwell] = useState(30);
  const [dwellStops, setDwellStops] = useState(1);
  const [stopId, setStopId] = useState(() => route.stops.some((s) => s.id === vehicle.nextStop?.id)
    ? vehicle.nextStop!.id : route.stops[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const maxStops = Math.min(5, route.stops.length - route.stops.findIndex((s) => s.id === stopId));
  useEffect(() => {
    const frame = requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const save = async () => {
    const targetStop = route.stops.find((s) => s.id === stopId);
    const message = contact.kind === "speed"
      ? `Маршрут ${route.number}, ${busLabel(vehicle.id)}: ориентир ${speed} км/ч только там, где это разрешено и безопасно. Соблюдайте действующие ограничения и ПДД. ${text.trim()}`
      : contact.kind === "dwell"
        ? `Маршрут ${route.number}, ${busLabel(vehicle.id)}: ${dwellStops === 1 ? "на остановке" : `на следующих ${dwellStops} остановках, начиная с`} «${targetStop?.name || ""}» ориентир стоянки ${dwell} с. Отправление только после завершения посадки и высадки. ${text.trim()}`
        : text.trim();
    if (contact.kind === "message" && !message) { setError("Напишите сообщение."); return; }
    if (contact.kind === "speed" && (!Number.isInteger(speed) || speed < 5 || speed > 60)) { setError("Укажите скорость от 5 до 60 км/ч."); return; }
    if (contact.kind === "dwell" && (!Number.isInteger(dwell) || dwell < 10 || dwell > 300 || !targetStop)) { setError("Укажите остановку и стоянку от 10 до 300 секунд."); return; }
    if (contact.kind === "dwell" && (!Number.isInteger(dwellStops) || dwellStops < 1 || dwellStops > 5)) { setError("Укажите от одной до пяти следующих остановок."); return; }
    if (contact.kind === "dwell" && dwellStops > maxStops) { setError("На маршруте нет столько остановок после выбранной."); return; }
    setBusy(true); setError("");
    try {
      const item = config.dataSource === "mock"
        ? (() => {
            const draft: Draft = { id: crypto.randomUUID(), routeId: route.id, vehicleId: vehicle.id, kind: contact.kind, text: message, createdAt: new Date().toISOString(), status: "draft" };
            localStorage.setItem(LOCAL_DRAFTS, JSON.stringify([draft, ...savedLocal()].slice(0, 500)));
            return draft;
          })()
        : await integrationRequest<Draft>("/dispatch/driver-messages", {
            method: "POST",
            body: JSON.stringify({ routeId: route.id, vehicleId: vehicle.id, kind: contact.kind, text: message, speedKmh: speed, dwellSec: dwell, dwellStops, stopId }),
          });
      onSaved(item);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <div ref={ref} className="driver-composer" role="region" aria-label={`Подготовить сообщение для ${busLabel(vehicle.id)}`}>
    <div className="driver-composer-top"><div><span className="dispatch-eyebrow">КАНАЛ ВОДИТЕЛЯ · ЧЕРНОВИК</span><h4>{busLabel(vehicle.id)} · {contact.kind === "message" ? "сообщение" : contact.kind === "speed" ? "рекомендация скорости" : "время стоянки"}</h4></div><button className="driver-close" aria-label="Закрыть сообщение" onClick={onClose}><X size={18}/></button></div>
    {contact.kind === "speed" && <label className="driver-field">Ориентир скорости, км/ч<input type="number" min="5" max="60" step="1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}/><small>Без данных о дорожном ограничении. Диспетчер обязан проверить его перед использованием.</small></label>}
    {contact.kind === "dwell" && <div className="driver-field-row"><label className="driver-field">Первая остановка<select value={stopId} onChange={(e) => setStopId(e.target.value)}>{route.stops.map((stop) => <option key={stop.id} value={stop.id}>{stop.name}</option>)}</select></label><label className="driver-field">Стоянка, секунд<input type="number" min="10" max="300" step="5" value={dwell} onChange={(e) => setDwell(Number(e.target.value))}/></label><label className="driver-field">Число остановок<input type="number" min="1" max={maxStops} step="1" value={dwellStops} onChange={(e) => setDwellStops(Number(e.target.value))}/></label></div>}
    <label className="driver-field">{contact.kind === "message" ? "Текст водителю" : "Комментарий диспетчера"}<textarea value={text} maxLength={250} rows={3} placeholder="Контекст для водителя" onChange={(e) => setText(e.target.value)}/></label>
    <div className="driver-composer-foot"><p>Это подготовка команды в учебном контуре. Канал доставки водителю пока не подключён.</p><button className="primary-button" disabled={busy} onClick={() => void save()}><Save size={15}/>{busy ? "Сохраняем…" : "Сохранить черновик"}</button></div>
    {error && <p className="dispatch-error" role="alert">{error}</p>}
  </div>;
}
