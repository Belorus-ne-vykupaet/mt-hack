# Transit Control — Realtime WebSocket Contract

## 1. Endpoint

```text
/api/v1/stream
```

Production:

```text
wss://<host>/api/v1/stream
```

FastAPI поддерживает WebSocket endpoints напрямую.

---

## 2. Роль WebSocket

WebSocket **не заменяет REST**.

```text
REST = snapshot / resync / analytics
WS   = incremental realtime events
```

Это позволяет безопасно переживать reconnect и потерю отдельных сообщений.

---

## 3. Event envelope

Каждое событие имеет одинаковую оболочку:

```ts
export interface StreamEvent<TPayload> {
  type: string;
  version: number;
  timestamp: string;
  sequence: number;
  payload: TPayload;
}
```

Пример:

```json
{
  "type": "vehicle.updated",
  "version": 1,
  "timestamp": "2026-09-21T15:24:15Z",
  "sequence": 9382,
  "payload": {
    "id": "vehicle-742",
    "position": {
      "lat": 55.7532,
      "lon": 37.6128
    },
    "speed_kmh": 17.4,
    "current_delay_sec": 145
  }
}
```

---

## 4. Event types

Минимум:

```text
system.hello
system.heartbeat

network.updated

vehicle.updated
vehicle.removed

route.updated

alert.created
alert.updated
alert.resolved

forecast.updated
```

---

## 5. `system.hello`

Первое сообщение после подключения:

```json
{
  "type": "system.hello",
  "version": 1,
  "timestamp": "2026-09-21T15:24:00Z",
  "sequence": 1000,
  "payload": {
    "stream_id": "stream-ab12",
    "server_version": "1.0.0"
  }
}
```

---

## 6. Heartbeat

Рекомендуемый период: 10 секунд.

```json
{
  "type": "system.heartbeat",
  "version": 1,
  "timestamp": "2026-09-21T15:24:10Z",
  "sequence": 1001,
  "payload": {}
}
```

Если heartbeat отсутствует, например, 30 секунд — состояние становится `stale`/`reconnecting`.

---

## 7. Sequence / gap detection

Frontend хранит `lastSequence`.

Если:

```text
newSequence !== lastSequence + 1
```

не пытаемся «угадывать», что потерялось.

Запускаем resync:

```text
sequence gap
      ↓
mark stale
      ↓
REST snapshot
      ↓
replace cache
      ↓
resume WS
```

---

## 8. Reconnect

Exponential backoff:

```text
1s
2s
4s
8s
15s
15s...
```

Добавить небольшой jitter.

После reconnect обязательно выполнить REST resync.

Нельзя предполагать, что сервер буферизовал все пропущенные события.

---

## 9. Connection states

```ts
export type RealtimeStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'stale'
  | 'offline';
```

UI всегда показывает текущий статус и время последнего сообщения.

---

## 10. Cache integration

WS не хранит собственную копию entities.

Событие обновляет TanStack Query cache:

```ts
queryClient.setQueryData(
  queryKeys.vehicles.all,
  old => patchVehicle(old, event.payload),
);
```

Таким образом REST и WS не создают два источника истины.

---

## 11. Realtime batching

При частой телеметрии нельзя вызывать React update на каждый network packet.

Realtime adapter может собирать события 50–200 ms и применять batch update.

Для координат ТС внутри одного batch допустима стратегия last-write-wins.

---

## 12. `forecast.updated`

```json
{
  "type": "forecast.updated",
  "version": 1,
  "timestamp": "2026-09-21T15:24:20Z",
  "sequence": 1044,
  "payload": {
    "generated_at": "2026-09-21T15:24:20Z",
    "horizon_min": 15,
    "routes": [],
    "vehicles": [],
    "segments": []
  }
}
```

---

## 13. Unknown event

Frontend не падает:

```ts
switch (event.type) {
  // known events...
  default:
    logger.warn('Unknown realtime event', event.type);
}
```

Если незнакомая версия critical-event — можно инициировать snapshot/resync.

---

## 14. Versioning

Каждый event имеет `version`.

Frontend обязан проверять поддержку версии.

Breaking изменение payload → новая версия message/event contract.

---

## 15. AsyncAPI

Контракт хранить:

```text
contracts/asyncapi.yaml
```

Минимальный пример:

```yaml
asyncapi: 3.1.0

info:
  title: Transit Control Realtime API
  version: 1.0.0

channels:
  realtime:
    address: /api/v1/stream
    messages:
      vehicleUpdated:
        $ref: '#/components/messages/VehicleUpdated'
```

AsyncAPI нужен как machine-readable contract event-driven API.

---

## 16. Realtime client abstraction

```ts
export interface RealtimeClient {
  connect(): Promise<void> | void;
  disconnect(): void;
  subscribe(
    listener: (event: StreamEvent<unknown>) => void,
  ): () => void;
}
```

Реализации:

```text
WebSocketRealtimeClient
MockRealtimeClient
```

UI не знает, какая реализация используется.

---

## 17. Источники

- FastAPI WebSockets: https://fastapi.tiangolo.com/advanced/websockets/
- AsyncAPI: https://www.asyncapi.com/docs/concepts/asyncapi-document
