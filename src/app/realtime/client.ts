import { config } from "../../shared/config/env";
export interface StreamEvent {
  type: string;
  version: number;
  timestamp: string;
  sequence: number;
  payload: Record<string, unknown>;
}
export interface RealtimeClient {
  connect(): void;
  disconnect(): void;
  subscribe(fn: (event: StreamEvent) => void): () => void;
}
export const backoff = (attempt: number, jitter = 0) =>
  Math.min(15000, 1000 * 2 ** attempt) + jitter;
export class WebSocketRealtimeClient implements RealtimeClient {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private attempt = 0;
  private stopped = false;
  private listeners = new Set<(e: StreamEvent) => void>();
  connect() {
    this.stopped = false;
    this.socket = new WebSocket(config.wsUrl);
    this.socket.onopen = () => {
      this.attempt = 0;
    };
    this.socket.onmessage = ({ data }) => {
      try {
        const e = JSON.parse(data);
        if (typeof e.type === "string" && Number.isInteger(e.sequence))
          this.listeners.forEach((fn) => fn(e));
      } catch {
        /* Malformed packet is isolated. */
      }
    };
    this.socket.onclose = () => {
      if (!this.stopped)
        this.retry = setTimeout(
          () => this.connect(),
          backoff(this.attempt++, Math.floor(Math.random() * 200)),
        );
    };
    this.socket.onerror = () => this.socket?.close();
  }
  disconnect() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.socket?.close();
    this.listeners.clear();
  }
  subscribe(fn: (e: StreamEvent) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
