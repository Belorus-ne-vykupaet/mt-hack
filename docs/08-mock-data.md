# Transit Control — Mock Data & Demo Scenarios

## 1. Цель

Frontend должен быть полностью демонстрируемым без:

- NDTP emulator;
- FastAPI;
- ML model;
- database.

При этом он должен работать **через те же интерфейсы и контракты**, что и будущий real backend.

---

## 2. REST mocking

Использовать MSW.

Правильный путь:

```text
UI
 ↓
Generated Query Hook
 ↓
HTTP request
 ↓
MSW handler
 ↓
OpenAPI-shaped response
```

Неправильно:

```ts
if (mock) {
  return fakeVehicles;
}
```

в feature/page.

---

## 3. Data source mode

Environment:

```env
VITE_DATA_SOURCE=mock
```

или:

```env
VITE_DATA_SOURCE=api
```

UI-код при переключении не меняется.

---

## 4. Bootstrap mocks

```ts
async function enableMocks() {
  if (config.dataSource !== 'mock') return;

  const { worker } = await import('@/mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}
```

В production `api` mode mock bundle можно не загружать.

---

## 5. Determinism

Ключевой demo не должен зависеть от `Math.random()`.

Использовать:

- фиксированные fixtures;
- scripted scenario;
- seeded RNG только для декоративных вариаций.

Demo всегда должен повторяться одинаково.

---

## 6. Сценарии

```ts
export type MockScenario =
  | 'normal'
  | 'rush-hour'
  | 'route-37-delay'
  | 'network-disruption'
  | 'recovery';
```

Default для защиты:

```env
VITE_MOCK_SCENARIO=route-37-delay
```

---

## 7. `route-37-delay` timeline

### T+0

```text
Route 37
current delay    +2.1 min
forecast         +3.0 min
risk             38%
```

### T+10 demo seconds

```text
current delay    +2.3 min
forecast         +4.8 min
risk             62%
```

### T+20

```text
forecast         +6.6 min
risk             78%
alert            HIGH
```

### T+30

```text
forecast         +8.4 min
risk             91%
alert            CRITICAL
```

---

## 8. Синхронные изменения UI

При сценарии одновременно меняются:

- route color;
- vehicle risk;
- alert list;
- KPI;
- histogram;
- forecast chart;
- top-routes ranking;
- route details.

Это важно: demo должен показывать **единый источник состояния**, а не 8 независимых анимаций.

---

## 9. Fixtures

```text
src/mocks/
├── fixtures/
│   ├── network.ts
│   ├── routes.ts
│   ├── vehicles.ts
│   ├── stops.ts
│   └── alerts.ts
├── handlers/
├── scenarios/
└── realtime/
```

---

## 10. Scenario clock

```ts
export interface ScenarioClock {
  start(): void;
  pause(): void;
  reset(): void;
  setSpeed(multiplier: number): void;
  getElapsedMs(): number;
}
```

`setSpeed` полезен для demo, чтобы 15 минут прогнозного развития не ждать в реальном времени.

---

## 11. Debug panel

Только в development/debug mode:

```text
Scenario
[ route-37-delay ▼ ]

[ reset ] [ play ] [ pause ]
Speed: 1x / 2x / 4x
```

Можно включать через:

```text
?debug=1
```

или env.

---

## 12. Mock realtime

Создать `MockRealtimeClient`, который выдаёт **реальные StreamEvent envelopes**, например:

```json
{
  "type": "vehicle.updated",
  "version": 1,
  "timestamp": "2026-09-21T15:24:15Z",
  "sequence": 42,
  "payload": {
    "id": "vehicle-742",
    "risk_probability": 0.78
  }
}
```

Таким образом переход к WebSocket меняет transport, а не business logic.

---

## 13. Synthetic geography

В development можно использовать реальный basemap Москвы, но mock positions/routes являются synthetic fixtures и не обязаны повторять настоящий маршрут общественного транспорта.

Это нормально: cartography — визуальный контекст, operational mock — демонстрационные данные.

---

## 14. Mock contract tests

Каждый scenario должен тестироваться:

- стартовое состояние;
- ожидаемый HIGH alert;
- переход в CRITICAL;
- reset;
- pause/resume;
- одинаковый seed → одинаковый результат.

Mock payload должен соответствовать OpenAPI shapes.

---

## 15. Orval + MSW

Orval умеет генерировать MSW mocks из OpenAPI. Используем generated handlers как основу и поверх них пишем сценарную логику.

Источник: https://orval.dev/docs/guides/msw/
