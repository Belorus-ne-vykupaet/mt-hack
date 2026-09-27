import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CloudRain, CloudSun, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { isRaining } from "../../entities/weather-current";
import type { CurrentWeatherSnapshot } from "../../entities/weather-current";
import { useUi } from "../../app/store";
import { integrationRequest } from "../../shared/api/integrations";

const base = "/external/yandex-weather";
const fetchStatus = () => integrationRequest<{ configured: boolean }>(`${base}/status`);
const fetchCurrent = () => integrationRequest<CurrentWeatherSnapshot>(`${base}/current`);

export function YandexWeatherBrief() {
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 60_000);
    return () => clearInterval(timer);
  }, []);
  const status = useQuery({
    queryKey: ["yandex-weather", "status"],
    queryFn: fetchStatus,
    retry: false,
    staleTime: 60_000,
  });
  const current = useQuery({
    queryKey: ["yandex-weather", "current"],
    queryFn: fetchCurrent,
    enabled: status.data?.configured === true,
    retry: false,
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000,
  });
  const snapshot = current.data;
  const fresh = !!snapshot && now - Date.parse(snapshot.fetchedAt) < 30 * 60_000;
  const points = fresh ? snapshot.points : [];
  const rain = points.filter(isRaining);
  const cloudy = points.filter((point) => point.cloudiness !== "CLEAR");
  const observed = snapshot && new Date(snapshot.fetchedAt).toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit",
  });
  const message = status.data?.configured === false
    ? "Серверный ключ Яндекс Погоды не подключён."
    : status.error?.message || current.error?.message ||
      (snapshot && !fresh ? "Данные устарели — ждём обновления." : "Получаем текущую погоду…");
  const openMap = () => {
    useUi.getState().set({ mapMode: "flow" });
    navigate("/overview");
  };

  return <section className="dispatch-weather" aria-label="Яндекс Погода сейчас" data-weather-source={fresh ? "yandex" : "unavailable"}>
    <div className="dispatch-weather-icon">{rain.length ? <CloudRain size={22} /> : <CloudSun size={22} />}</div>
    <div className="dispatch-weather-body">
      <div className="dispatch-weather-heading"><strong>Яндекс Погода · Москва</strong><span>ТЕКУЩИЙ МОМЕНТ</span></div>
      {fresh ? <>
        <p>{rain.length ? `Осадки в ${rain.length} из ${points.length} точек` : `Дождя нет в ${points.length} проверенных точках`}
          <span> · {cloudy.length ? `облачно в ${cloudy.length}` : "ясно во всех"} {cloudy.length ? `из ${points.length}` : "точках"}</span>
        </p>
        {!!rain.length && <small>Осадки: {rain.map((point) => point.name).join(", ")}</small>}
        <small>Получено в {observed} МСК</small>
      </> : <p role="status">{message}</p>}
    </div>
    <button className="dispatch-weather-map" onClick={openMap} title="Открыть погоду на 3D-карте">
      На карте <ExternalLink size={14} />
    </button>
  </section>;
}
