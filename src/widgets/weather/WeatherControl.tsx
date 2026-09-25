/* eslint-disable react/set-state-in-effect -- Synchronizes the external MapLibre layer and tile loader. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Map as LibreMap } from "maplibre-gl";
import {
  Cloud,
  CloudRain,
  Eye,
  RefreshCw,
  X,
  ExternalLink,
} from "lucide-react";
import { integrationRequest } from "../../shared/api/integrations";
import { config } from "../../shared/config/env";
import { weatherTiles } from "../../entities/weather";
import type { CurrentWeatherSnapshot } from "../../entities/weather-current";
import { isRaining, weatherPointLabel } from "../../entities/weather-current";
import { currentWeatherMasks } from "./current-masks";
import { WeatherLayer } from "./WeatherLayer";
import { useWeatherPreferences } from "./store";
import "./weather.css";
const base = "/external/yandex-weather";
// Query cache outlives this component. Do not let query functions capture its
// scope: other closures in the same scope retain the MapLibre map and canvas.
const fetchWeatherStatus = () =>
  integrationRequest<{ configured: boolean }>(`${base}/status`);
const fetchCurrentWeather = () =>
  integrationRequest<CurrentWeatherSnapshot>(`${base}/current`);
export function WeatherControl({
  map,
  dark,
}: {
  map: LibreMap;
  dark: boolean;
}) {
  const prefs = useWeatherPreferences();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [revision, setRevision] = useState(0);
  const [tileKey, setTileKey] = useState("");
  const [panelHeight, setPanelHeight] = useState(520);
  const [stage, setStage] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [failure, setFailure] = useState("");
  const [graphicsError, setGraphicsError] = useState(false);
  const [reduced, setReduced] = useState(
    matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const layer = useRef<WeatherLayer | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const status = useQuery({
    queryKey: ["yandex-weather", "status"],
    queryFn: fetchWeatherStatus,
    enabled: prefs.enabled,
    retry: false,
    staleTime: 60000,
  });
  const current = useQuery({
    queryKey: ["yandex-weather", "current"],
    queryFn: fetchCurrentWeather,
    enabled: prefs.enabled && status.data?.configured === true,
    retry: false,
    staleTime: 900000,
    refetchInterval: 900000,
  });
  const snapshot = current.data;
  const fresh = !!snapshot && now - Date.parse(snapshot.fetchedAt) < 30 * 60000;
  const active = prefs.enabled && fresh && stage === "ready" && !graphicsError;
  const rainCount = snapshot?.points.filter(isRaining).length || 0;
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 30000);
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const listener = () => setReduced(media.matches);
    media.addEventListener("change", listener);
    return () => {
      clearInterval(t);
      media.removeEventListener("change", listener);
    };
  }, []);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => {
    const update = () => {
      const b = map.getBounds();
      setPanelHeight(Math.max(140, map.getContainer().clientHeight - 88));
      setTileKey(
        weatherTiles([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
          .map((t) => `${t.z}/${t.x}/${t.y}`)
          .join(","),
      );
    };
    update();
    map.on("moveend", update);
    map.on("resize", update);
    const weather = new WeatherLayer();
    try {
      map.addLayer(weather);
      layer.current = weather;
    } catch {
      setGraphicsError(true);
      weather.onRemove();
    }
    return () => {
      map.off("moveend", update);
      map.off("resize", update);
      layer.current = null;
      try {
        if (map.getLayer(weather.id)) map.removeLayer(weather.id);
      } catch {
        // The parent may already have destroyed the map and its style.
      } finally {
        // MapLibre map.remove() can clear the style without calling custom
        // layer onRemove. Always release our resources, even if getLayer is empty.
        weather.onRemove();
      }
    };
  }, [map]);
  useEffect(() => {
    layer.current?.configure({
      enabled: active,
      clouds: prefs.clouds,
      rainfall: prefs.rain,
      animate: prefs.animate && !reduced && !config.visualTest,
      intensity: prefs.intensity,
      dark,
    });
  }, [
    active,
    prefs.clouds,
    prefs.rain,
    prefs.animate,
    prefs.intensity,
    reduced,
    dark,
  ]);
  useEffect(() => {
    const renderer = layer.current;
    if (!renderer || !prefs.enabled || !snapshot || !fresh || !tileKey) {
      renderer?.setImages([]);
      setStage("idle");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const tiles = tileKey.split(",").map((key) => {
      const [z, x, y] = key.split("/").map(Number);
      return { z, x, y };
    });
    setStage("loading");
    setFailure("");
    void currentWeatherMasks(snapshot.points, tiles, controller.signal)
      .then((images) => {
        if (cancelled) {
          images.forEach((i) => i.image.close());
          return;
        }
        renderer.setImages(images);
        setStage("ready");
      })
      .catch(() => {
        if (!cancelled) {
          renderer.setImages([]);
          setStage("error");
          setFailure(
            "Не удалось отобразить погодный слой. Попробуйте обновить данные.",
          );
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [map, tileKey, snapshot, fresh, prefs.enabled, revision]);
  const missingKey = status.data?.configured === false;
  const message = graphicsError
    ? "Погодный слой недоступен на этом устройстве. Карта продолжает работать."
    : status.error?.message ||
      (current.error
        ? `${current.error.message}${fresh ? " Показаны последние полученные данные." : ""}`
        : "") ||
      failure ||
      (missingKey
        ? "Яндекс Погода пока не подключена. Нужен серверный ключ API погоды."
        : !tileKey
          ? "Погодный слой доступен в Москве и ближайших окрестностях. Верните карту к Москве."
          : snapshot && !fresh
            ? "Данные погоды устарели. Обновите данные."
            : "");
  const time = snapshot
    ? new Date(snapshot.fetchedAt).toLocaleTimeString("ru-RU", {
        timeZone: "Europe/Moscow",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const label = !prefs.enabled
    ? "Выключена"
    : message
      ? "Нет данных"
      : !prefs.clouds && !prefs.rain
        ? "Слои скрыты"
        : active
          ? "Сейчас"
          : "Загрузка";
  return (
    <div
      className="weather-control"
      ref={panel}
      data-weather-active={active}
      data-weather-stage={stage}
      data-weather-time={snapshot?.fetchedAt || ""}
      data-weather-mode="current-points"
      data-weather-rain-points={rainCount}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          panel.current
            ?.querySelector<HTMLButtonElement>(".weather-trigger")
            ?.focus();
        }
      }}
    >
      <button
        className={`weather-trigger ${active ? "is-active" : ""}`}
        aria-label="Погода на 3D-карте"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Cloud size={16} />
        <span>
          Погода<small>{label}</small>
        </span>
      </button>
      {open && (
        <section
          className="weather-popover"
          aria-label="Настройки погоды"
          style={{ maxHeight: `min(${panelHeight}px, calc(100dvh - 100px))` }}
        >
          <header>
            <div>
              <span className="weather-eyebrow">АТМОСФЕРА / 3D</span>
              <h3>Погода над городом</h3>
            </div>
            <button
              className="icon-button"
              aria-label="Закрыть настройки погоды"
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </button>
          </header>
          <label className="weather-master">
            <span>
              <strong>Погодный слой</strong>
              <small>Текущая погода по координатам</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Погодный слой"
              checked={prefs.enabled}
              onChange={(e) => prefs.set({ enabled: e.target.checked })}
            />
          </label>
          <div className="weather-source">
            <span className="weather-source-mark">Я</span>
            <div>
              <strong>Яндекс Погода</strong>
              <small>
                {active
                  ? `Сейчас · получено в ${time} МСК`
                  : "Текущая погода · Москва"}
              </small>
            </div>
            <a
              href="https://yandex.ru/pogoda/maps/nowcast"
              target="_blank"
              rel="noreferrer"
              aria-label="Открыть карту Яндекс Погоды"
            >
              <ExternalLink size={15} />
            </a>
          </div>
          {config.officialMode && (
            <p className="weather-note">
              Погода показывает текущий момент, а движение автобусов — архивный
              поток. Этот слой не участвует в прогнозе задержек.
            </p>
          )}
          {message && prefs.enabled && (
            <p className="weather-status" role="status">
              {message}
            </p>
          )}
          {snapshot && fresh && prefs.enabled && (
            <div className="weather-current-summary">
              <strong>
                {rainCount
                  ? `Дождь: ${rainCount} из ${snapshot.points.length} точек`
                  : "В проверенных точках дождя нет"}
              </strong>
              <span>Форма облаков и границы зон условные</span>
              {!!snapshot.unavailablePoints.length && (
                <small>
                  Нет данных: {snapshot.unavailablePoints.length} из{" "}
                  {snapshot.points.length + snapshot.unavailablePoints.length}{" "}
                  точек
                </small>
              )}
            </div>
          )}
          <fieldset disabled={!prefs.enabled}>
            <label>
              <Cloud size={19} />
              <span>
                <strong>Облака</strong>
                <small>Объёмный слой над картой</small>
              </span>
              <input
                type="checkbox"
                aria-label="Облака"
                checked={prefs.clouds}
                onChange={(e) => prefs.set({ clouds: e.target.checked })}
              />
            </label>
            <label>
              <CloudRain size={19} />
              <span>
                <strong>Дождь и осадки</strong>
                <small>Рядом с точками, где идёт дождь</small>
              </span>
              <input
                type="checkbox"
                aria-label="Дождь и осадки"
                checked={prefs.rain}
                onChange={(e) => prefs.set({ rain: e.target.checked })}
              />
            </label>
            <label className="weather-strength">
              <span>
                <Eye size={15} />
                Выразительность
              </span>
              <output>{Math.round(prefs.intensity * 100)}%</output>
              <input
                type="range"
                aria-label="Выразительность погоды"
                min="0.25"
                max="1"
                step="0.05"
                value={prefs.intensity}
                onChange={(e) =>
                  prefs.set({ intensity: Number(e.target.value) })
                }
              />
            </label>
            <label className="weather-motion">
              <span>Анимация атмосферы</span>
              <input
                type="checkbox"
                aria-label="Анимация атмосферы"
                disabled={reduced}
                checked={prefs.animate && !reduced}
                onChange={(e) => prefs.set({ animate: e.target.checked })}
              />
            </label>
          </fieldset>
          {reduced && (
            <p className="weather-note">
              Движение отключено настройкой системы.
            </p>
          )}
          <p className="weather-note">
            Облака соединяют соседние точки с дождём. Если дождя нет ни в одной
            проверенной точке, слой остаётся ясным независимо от облачности. Это
            условная визуализация данных Яндекса, а не радарная карта. Только
            текущая погода: ползунок прогноза автобусов её не меняет. Обновление
            раз в 15 минут.
          </p>
          {snapshot && fresh && (
            <details className="weather-point-list">
              <summary>
                Погода по районам · {snapshot.points.length} точек
              </summary>
              {snapshot.points.map((point) => (
                <button
                  key={point.id}
                  className="weather-point"
                  onClick={() => {
                    map.flyTo({
                      center: [point.lon, point.lat],
                      zoom: 11.4,
                      duration: reduced ? 0 : 700,
                    });
                    setOpen(false);
                  }}
                >
                  {isRaining(point) ? (
                    <CloudRain size={14} />
                  ) : (
                    <Cloud size={14} />
                  )}
                  <span>{point.name}</span>
                  <small>{weatherPointLabel(point)}</small>
                </button>
              ))}
            </details>
          )}
          <footer>
            <a href="https://yandex.ru/pogoda" target="_blank" rel="noreferrer">
              Данные Яндекс Погоды
            </a>
            <button
              className="text-button"
              disabled={
                !prefs.enabled || status.isFetching || current.isFetching
              }
              onClick={() => {
                setNow(Date.now());
                setRevision((v) => v + 1);
                void status.refetch();
                if (status.data?.configured) void current.refetch();
              }}
            >
              <RefreshCw size={13} />
              Обновить
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
