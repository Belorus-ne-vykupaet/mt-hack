import { WebSocket } from "ws";

export const MAX_STREAM_BUFFER_BYTES = 1_000_000;

// Wait for each frame to leave the socket before enqueueing the next one. A
// healthy client's first fleet snapshot can exceed the queue limit in total.
// The deadline still bounds how long a client can retain a snapshot in memory.
export async function sendStreamBatch(
  ws: WebSocket,
  sequence: number,
  events: readonly (readonly [string, unknown])[],
  deadlineMs = 3000,
): Promise<number> {
  const deadline = Date.now() + deadlineMs;
  for (const [type, payload] of events) {
    if (ws.readyState !== WebSocket.OPEN) break;
    if (ws.bufferedAmount > MAX_STREAM_BUFFER_BYTES || Date.now() >= deadline) {
      ws.terminate();
      break;
    }
    const message = JSON.stringify({
      type, payload, version: 1, sequence: sequence + 1,
      timestamp: new Date().toISOString(),
    });
    const sent = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.off("close", onClose);
        if (!ok && ws.readyState === WebSocket.OPEN) ws.terminate();
        resolve(ok);
      };
      const onClose = () => finish(false);
      const timer = setTimeout(() => finish(false), Math.max(1, deadline - Date.now()));
      ws.once("close", onClose);
      try { ws.send(message, (error) => finish(!error)); }
      catch { finish(false); }
    });
    if (!sent) break;
    sequence += 1;
  }
  return sequence;
}

export function sendStreamEvent(
  ws: WebSocket,
  sequence: number,
  type: string,
  payload: unknown,
): number {
  if (ws.readyState !== WebSocket.OPEN) return sequence;
  if (ws.bufferedAmount > MAX_STREAM_BUFFER_BYTES) {
    ws.terminate();
    return sequence;
  }
  const next = sequence + 1;
  ws.send(JSON.stringify({
    type,
    payload,
    version: 1,
    sequence: next,
    timestamp: new Date().toISOString(),
  }));
  return next;
}
