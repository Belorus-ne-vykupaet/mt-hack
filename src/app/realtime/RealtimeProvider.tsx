import { useEffect } from "react";
import { config } from "../../shared/config/env";
import { resync } from "../../entities/queries";
import { WebSocketRealtimeClient, backoff } from "./client";
import type { RealtimeClient } from "./client";
import { StreamBridge } from "./bridge";
import { useConnection } from "../store";
export function RealtimeProvider() {
  useEffect(() => {
    let stopped = false;
    let client: RealtimeClient | undefined;
    const bridge = new StreamBridge();
    let retry: ReturnType<typeof setTimeout> | undefined;
    let starting = false;
    let attempt = 0;
    const offline = () => useConnection.getState().set("offline");
    const online = () => {
      useConnection.getState().set("reconnecting");
      if (!client) void start();
      else void bridge.sync();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    const start = async () => {
      if (stopped || starting || client) return;
      starting = true;
      clearTimeout(retry);
      try {
        await resync();
        if (stopped) return;
        client =
          config.dataSource === "mock"
            ? new (await import("../../mocks/realtime")).MockRealtimeClient()
            : new WebSocketRealtimeClient();
        if (stopped) return;
        client.subscribe(bridge.consume);
        client.connect();
      } catch {
        if (!stopped) {
          useConnection.getState().set("offline");
          retry = setTimeout(() => void start(), backoff(attempt++));
        }
      } finally {
        starting = false;
      }
    };
    void start();
    const timer = setInterval(() => {
      if (!navigator.onLine) {
        offline();
        return;
      }
      if (Date.now() - bridge.lastMessage > 30000)
        useConnection.getState().set("stale");
    }, 1000);
    return () => {
      stopped = true;
      client?.disconnect();
      bridge.close();
      clearInterval(timer);
      clearTimeout(retry);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);
  return null;
}
