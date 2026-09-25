import { useEffect, useState } from "react";
import { useConnection } from "../app/store";
import { config } from "../shared/config/env";

/** Keep the one-second clock update out of the map and dashboard tree. */
export function HeaderStatus() {
  const connection = useConnection();
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    if (config.visualTest) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setClock(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <>
      <div className={`connection ${connection.status}`}>
        <i />
        <div>
          <strong>
            {connection.status === "connected"
              ? config.csvMode
                ? "Архив CSV"
                : "Поток активен"
              : connection.status === "connecting"
                ? "Подключение"
                : connection.status === "stale"
                  ? "Данные устарели"
                  : connection.status === "offline"
                    ? "Нет соединения"
                    : "Переподключение"}
          </strong>
          <small>
            {connection.status === "connected"
              ? config.csvMode
                ? "Время указано под картой"
                : config.officialMode
                  ? "Данные карты каждые 5 с"
                  : "Обновлено только что"
              : `Обновление ${Math.max(0, Math.floor((clock.getTime() - connection.lastUpdate) / 1000))} сек назад`}
          </small>
        </div>
      </div>
      <div className="clock">
        <strong>
          {config.visualTest
            ? "18:24:17"
            : clock.toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow" })}
        </strong>
        <small>
          {(config.visualTest
            ? new Date("2026-09-22T15:24:00Z")
            : clock
          ).toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
            timeZone: "Europe/Moscow",
          })}{" "}
          · МСК
        </small>
      </div>
    </>
  );
}
