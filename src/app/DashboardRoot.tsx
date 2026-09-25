import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../entities/queries";
import { config } from "../shared/config/env";
import { RealtimeProvider } from "./realtime/RealtimeProvider";
import { useDocumentVisible } from "../shared/lib/document-visibility";
import App from "./App";
let bootstrap: Promise<unknown> | undefined;
function start() {
  if (!bootstrap)
    bootstrap =
      config.dataSource === "mock"
        ? import("../mocks/browser")
            .then((m) =>
              m.worker.start({ onUnhandledRequest: "bypass", quiet: true }),
            )
            .catch((error) => {
              bootstrap = undefined;
              throw error;
            })
        : Promise.resolve();
  return bootstrap;
}
export default function DashboardRoot() {
  const documentVisible = useDocumentVisible();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let mounted = true;
    void start()
      .then(() => {
        if (mounted) setState("ready");
      })
      .catch(() => {
        if (mounted) setState("error");
      });
    return () => {
      mounted = false;
    };
  }, []);
  return state === "ready" ? (
    <QueryClientProvider client={queryClient}>
      {documentVisible && <RealtimeProvider />}
      <App />
    </QueryClientProvider>
  ) : (
    <div className="route-loading">
      {state === "loading" ? (
        "Открываем транспортную сеть…"
      ) : (
        <div>
          Не удалось загрузить демонстрацию.{" "}
          <button onClick={() => location.reload()}>Повторить</button>
        </div>
      )}
    </div>
  );
}
