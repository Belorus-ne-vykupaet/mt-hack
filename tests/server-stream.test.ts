import { expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { MAX_STREAM_BUFFER_BYTES, sendStreamEvent } from "../server/stream";

it("terminates a slow client before serializing another event", () => {
  const send = vi.fn();
  const terminate = vi.fn();
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: MAX_STREAM_BUFFER_BYTES + 1,
    send,
    terminate,
  } as unknown as WebSocket;
  const circular: { self?: unknown } = {};
  circular.self = circular;
  expect(sendStreamEvent(socket, 7, "route.updated", circular)).toBe(7);
  expect(terminate).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
});

it("keeps per-client sequence consecutive for accepted messages", () => {
  const send = vi.fn();
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send,
    terminate: vi.fn(),
  } as unknown as WebSocket;
  const next = sendStreamEvent(socket, 4, "system.heartbeat", { stale: true });
  expect(next).toBe(5);
  expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({
    type: "system.heartbeat", sequence: 5, payload: { stale: true },
  });
});
