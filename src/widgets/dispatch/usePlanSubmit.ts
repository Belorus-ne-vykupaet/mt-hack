import { useRef, useState } from "react";
import { useDispatch } from "../../app/dispatch-store";
import { config } from "../../shared/config/env";
import { queryClient, resync } from "../../entities/queries";
import {
  useApiDispatch,
  integrationRequest,
  refreshApiDispatch,
  commandKey,
  IntegrationError,
} from "../../shared/api/integrations";
import type { CommandState } from "../../shared/api/integrations";
import type { DispatchPlan } from "../../entities/dispatch";

/** Saves or applies a plan: in the local demo store, or as an idempotent API command. */
export function usePlanSubmit(onNotice: (s: string) => void) {
  const local = useDispatch();
  const api = useApiDispatch();
  const pendingApi = useRef<{
    signature: string;
    key: string;
    body: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const apiUnavailable =
    config.dispatchApi && (!api.commands.data || api.commands.isError);
  const submit = async (draft: DispatchPlan, activate: boolean) => {
    setError("");
    setBusy(true);
    try {
      if (config.dispatchApi) {
        if (!api.commands.data)
          throw new Error("Дождитесь загрузки серверного журнала.");
        const signature = JSON.stringify({ draft, activate });
        if (!pendingApi.current || pendingApi.current.signature !== signature)
          pendingApi.current = {
            signature,
            key: crypto.randomUUID(),
            body: JSON.stringify({
              plan: draft,
              mode: activate ? "apply" : "plan",
              revision: api.commands.data.revision,
            }),
          };
        const response = await integrationRequest<CommandState>(
          "/dispatch/commands",
          {
            method: "POST",
            headers: { "Idempotency-Key": pendingApi.current.key },
            body: pendingApi.current.body,
          },
        );
        pendingApi.current = null;
        queryClient.setQueryData(commandKey, response);
        await refreshApiDispatch();
        if (activate) {
          try {
            await resync();
          } catch {
            onNotice(
              "API подтвердил применение команды. Данные карты пока не обновились. Не отправляйте команду повторно; проверьте подключение.",
            );
            return true;
          }
        }
        onNotice(
          activate
            ? "API подтвердил: команда принята и применена в учебном контуре."
            : "План сохранён в серверном журнале.",
        );
        return true;
      }
      local.save(
        {
          ...draft,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        },
        activate,
      );
      if (activate) {
        try {
          await resync();
        } catch {
          onNotice(
            "Демосценарий сохранён и применён. Данные карты пока не обновились; проверьте подключение или перезагрузите страницу. Сценарий можно отменить в журнале.",
          );
          return true;
        }
      }
      onNotice(
        activate
          ? "Демосценарий применён. Количество автобусов и расчётный прогноз обновлены на карте."
          : "План сохранён в журнале. Он не меняет данные на карте.",
      );
      return true;
    } catch (e) {
      if (e instanceof IntegrationError && e.status >= 400 && e.status < 500) {
        pendingApi.current = null;
        await refreshApiDispatch();
      }
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { submit, busy, error, setError, apiUnavailable };
}
