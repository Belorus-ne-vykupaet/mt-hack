import { WebSocket } from "ws";

export const MAX_STREAM_BUFFER_BYTES = 1_000_000;

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
