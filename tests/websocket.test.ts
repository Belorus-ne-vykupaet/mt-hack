import { afterEach, it, expect, vi } from "vitest";
import { WebSocketRealtimeClient } from "../src/app/realtime/client";
class Socket {
  static instances: Socket[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (e: { data: string }) => void;
  constructor() {
    Socket.instances.push(this);
  }
  close() {
    this.onclose?.();
  }
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Socket.instances = [];
});
it("reconnects after a closed socket and never reconnects after disposal", () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.stubGlobal("WebSocket", Socket);
  const client = new WebSocketRealtimeClient();
  const received = vi.fn();
  client.subscribe(received);
  client.connect();
  const first = Socket.instances[0];
  first.onopen?.();
  first.onmessage?.({ data: "not json" });
  expect(received).not.toHaveBeenCalled();
  first.onmessage?.({
    data: JSON.stringify({
      type: "system.heartbeat",
      sequence: 1,
      version: 1,
      payload: {},
    }),
  });
  expect(received).toHaveBeenCalledOnce();
  first.close();
  vi.advanceTimersByTime(1000);
  expect(Socket.instances).toHaveLength(2);
  client.disconnect();
  vi.advanceTimersByTime(30000);
  expect(Socket.instances).toHaveLength(2);
});
