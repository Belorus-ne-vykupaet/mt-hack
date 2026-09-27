import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Cable,
  CloudSun,
  Route,
  BrainCircuit,
  Server,
  RefreshCw,
} from "lucide-react";
import { config } from "../shared/config/env";
import { integrationRequest } from "../shared/api/integrations";
import type { IntegrationState } from "../shared/api/integrations";
import type { Route as TransitRoute } from "../entities/models";
import "../styles/integrations.css";
export default function Integrations({ routes }: { routes: TransitRoute[] }) {
  const status = useQuery({
    queryKey: ["integration-status"],
    queryFn: () => integrationRequest<IntegrationState>("/integrations"),
    retry: false,
    refetchInterval: 15000,
  });
  const [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const [weather, setWeather] = useState<any>(null),
    [traffic, setTraffic] = useState<any>(null),
    [routeId, setRouteId] = useState("");
  const switchSource = (source: "mock" | "api") => {
    sessionStorage.setItem("transit-data-source", source);
    location.href = "/integrations";
  };
  const run = async (kind: "weather" | "traffic" | "session") => {
    setError("");
    setBusy(kind);
    try {
      if (kind === "session") {
        await integrationRequest("/session", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        setToken("");
        if (config.dataSource === "api") location.reload();
        else await status.refetch();
      } else {
        const data = await integrationRequest(
          kind === "weather"
            ? "/external/weather"
            : `/external/traffic?route_id=${encodeURIComponent(routeId || routes[0]?.id || "")}`,
        );
        if (kind === "weather") setWeather(data);
        else setTraffic(data);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const s = status.data;
  return (
    <section className="integrations-page">
      <div className="integration-intro">
        <div>
          <span className="dispatch-eyebrow">
            ПОДКЛЮЧЕНИЕ К РЕАЛЬНЫМ СИСТЕМАМ
          </span>
          <h2>От данных — к решению</h2>
          <p>Телеметрия → прогноз → рекомендация → команда → подтверждение.</p>
        </div>
        <span className="integration-pill">
          {config.dataSource === "api"
            ? "Сайт получает данные по API"
            : "Локальная демонстрация"}
        </span>
      </div>
      <div className="integration-flow" aria-label="Цепочка интеграции">
        <span>CSV / эмулятор</span>
        <b>→</b>
        <span>REST + WebSocket</span>
        <b>→</b>
        <span>ML / базовый прогноз</span>
        <b>→</b>
        <span>Диспетчер</span>
      </div>
      <div className="integration-connection">
        <Server size={22} />
        <div>
          <h3>{s ? "API-сервис подключён" : "Подключение API-сервиса"}</h3>
          <p>
            {s
              ? `${s.network.source}. Исполнитель: ${s.dispatch.executor}.`
              : "Запустите API-сервис проекта, затем проверьте соединение."}
          </p>
          <small>
            Учебный контур: команды меняют серверную демонстрацию. В
            транспортную систему города они не отправляются.
          </small>
        </div>
        <div className="integration-actions">
          <button
            onClick={() => void status.refetch()}
            disabled={status.isFetching}
          >
            <RefreshCw size={15} /> Проверить связь
          </button>
          {s && config.dataSource !== "api" && (
            <button
              className="primary-button"
              onClick={() => switchSource("api")}
            >
              Подключить сайт к API
            </button>
          )}
          {config.dataSource === "api" && (
            <button onClick={() => switchSource("mock")}>
              Вернуться к локальному демо
            </button>
          )}
        </div>
      </div>
      {status.isError && (
        <div className="integration-error" role="alert">
          {status.error.message}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run("session");
            }}
          >
            <label>
              Ключ доступа к вашему API
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Если сервер требует вход"
              />
            </label>
            <button disabled={!token || !!busy}>Войти в API</button>
          </form>
        </div>
      )}
      {error && (
        <p className="integration-error" role="alert">
          {error}
        </p>
      )}
      <div className="integration-grid">
        <article>
          <Cable />
          <h3>Команды диспетчера</h3>
          <span className="integration-pill">
            {s ? "REST API готов" : "Ожидает подключения"}
          </span>
          <p>
            Изменение выпуска и стоянок, проверка резерва, защита от повторной
            отправки, серверный журнал и отмена.
          </p>
          <small>
            {s?.dispatch.persisted
              ? "Журнал сохраняется на сервере и переживает перезапуск."
              : "В API-режиме решения хранятся отдельно от локальных планов браузера."}
          </small>
          <a href="/dispatch">Открыть диспетчера →</a>
        </article>
        <article>
          <BrainCircuit />
          <h3>Сервис прогнозов</h3>
          <span className="integration-pill">
            {s?.model.status === "connected"
              ? "ML-сервис подключён"
              : s?.model.status === "fallback"
                ? "ML недоступен · базовый прогноз"
                : "Базовый прогноз"}
          </span>
          <p>
            Адрес вашей ML-модели настраивается на сервере. Ответ проверяется по
            автобусам, времени и допустимым значениям.
          </p>
          <small>
            Предсказание модели. Подсказки управления
            пока формируются правилами; эффект действия модель не оценивает.
          </small>
        </article>
        <article>
          <CloudSun />
          <h3>Погода Москвы</h3>
          <span className="integration-pill">
            Open-Meteo · {weather ? "данные получены" : "по запросу"}
          </span>
          <p>
            Температура и осадки с временем наблюдения. Общий серверный кэш на
            15 минут.
          </p>
          <button
            onClick={() => void run("weather")}
            disabled={!s || !!busy || s.weather.status === "disabled"}
          >
            {busy === "weather" ? "Загрузка…" : "Получить погоду"}
          </button>
          {weather && (
            <div className="integration-result">
              <strong>
                {weather.temperatureC} °C · {weather.precipitationMm} мм
              </strong>
              <small>
                {new Date(weather.observedAt).toLocaleString("ru-RU")} ·{" "}
                {weather.cached ? "из кэша" : "от провайдера"}
              </small>
              <p>{weather.note}</p>
              <a
                href="https://open-meteo.com/"
                target="_blank"
                rel="noreferrer"
              >
                Источник: Open-Meteo
              </a>
            </div>
          )}
        </article>
        <article>
          <Route />
          <h3>Дорожный трафик</h3>
          <span className="integration-pill">
            {s?.traffic.status === "configured"
              ? "Ключ настроен"
              : "Нужен серверный ключ Яндекса"}
          </span>
          <p>
            Сравнение автомобильного проезда с пробками и без них на участке
            между первыми остановками.
          </p>
          <select
            aria-label="Маршрут для проверки трафика"
            value={routeId || routes[0]?.id || ""}
            onChange={(e) => setRouteId(e.target.value)}
          >
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.number} · {r.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => void run("traffic")}
            disabled={
              !s ||
              s.traffic.status !== "configured" ||
              !routes.length ||
              !!busy
            }
          >
            {busy === "traffic" ? "Загрузка…" : "Проверить участок"}
          </button>
          {traffic && (
            <div className="integration-result">
              <strong>
                {Math.round(traffic.durationSec)} с с трафиком ·{" "}
                {Math.round(traffic.freeFlowSec)} с без
              </strong>
              <p>
                {traffic.from} → {traffic.to}
              </p>
              <small>
                {traffic.comparable
                  ? "Геометрии двух ответов совпали"
                  : "Пути различаются — коэффициент не вычислен"}
              </small>
              <p>{traffic.note}</p>
              <a
                href="https://yandex.ru/maps-api/docs/router-api/"
                target="_blank"
                rel="noreferrer"
              >
                Источник: Яндекс Router API
              </a>
            </div>
          )}
        </article>
      </div>
      <div className="integration-footnote">
        <strong>Внешние данные показаны отдельно.</strong> Текущие пробки и
        погода не подмешиваются к историческому CSV. Для модели нужны
        совпадающее время, проверенная геометрия и измеренный выигрыш по MAE.
      </div>
      {s && (
        <a
          className="text-button"
          href={`${config.integrationUrl}/openapi.json`}
          target="_blank"
          rel="noreferrer"
        >
          Открыть контракт API →
        </a>
      )}
    </section>
  );
}
