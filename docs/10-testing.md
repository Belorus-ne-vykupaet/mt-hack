# Transit Control — Testing Strategy

> **Архивная стратегия тестирования.** Документ описывает исходный план покрытия и не является перечнем обязательных CI-gates текущей версии. Актуальные команды проверки приведены в [README](../README.md) и [инструкции для жюри](../JURY_QUICKSTART.md).

## 1. Цель

Тесты должны защищать прежде всего:

- data contracts;
- adapters;
- realtime synchronization;
- ключевые пользовательские сценарии;
- визуальную стабильность dashboard;
- reconnect/offline behavior.

---

## 2. Test stack

```text
Vitest
React Testing Library
MSW
Playwright
```

---

## 3. Unit tests

Vitest.

Покрыть:

- DTO adapters;
- risk/delay formatters;
- date/time formatters;
- selectors;
- filter predicates;
- query-cache patch functions;
- timeline calculations;
- reconnect/backoff logic;
- sequence-gap detection.

Пример adapter test:

```ts
it('maps VehicleDto to Vehicle', () => {
  expect(mapVehicleDto(dto)).toEqual({
    id: 'vehicle-742',
    routeId: '37',
    // ...
  });
});
```

---

## 4. Component tests

Testing Library.

Минимум:

- `AlertCard`;
- `VehiclePanel`;
- `RoutePanel`;
- `MetricCard`;
- `Search`;
- `Timeline`;
- `ConnectionIndicator`.

Проверять поведение пользователя, а не CSS implementation details.

Плохо:

```text
div has class abc123
```

Хорошо:

```text
user sees "91%"
user sees "CRITICAL"
```

---

## 5. API contract checks

CI после `pnpm api:generate` проверяет отсутствие незакоммиченного diff.

Пример:

```bash
pnpm api:generate
git diff --exit-code
```

Если OpenAPI поменялся, generated client должен быть обновлён в том же PR.

---

## 6. Mock contract

MSW payloads должны соответствовать тем же generated types.

Не допускается divergence:

```text
real API: predicted_delay_sec
mock: prediction
```

---

## 7. WebSocket tests

Проверить:

- `vehicle.updated` корректно patches vehicle;
- `vehicle.removed` удаляет entity;
- `alert.created` добавляет alert;
- `alert.resolved` обновляет статус;
- `sequence gap` запускает resync;
- unknown event не падает;
- heartbeat обновляет connection health;
- reconnect вызывает snapshot reload.

---

## 8. E2E — Playwright

Обязательные сценарии.

### Startup

```text
open /overview
→ shell visible
→ mock data loaded
→ connection ONLINE
```

### Mode switch

```text
Overview → Analytics → Flow
```

без full page reload.

### Vehicle selection

```text
click vehicle
→ panel opens
→ selected vehicle highlighted
```

### Route selection

```text
click route 37
→ route selected
→ details shown
```

### Alert navigation

```text
click critical alert
→ map focuses affected route
→ route/details selected
```

### Timeline

```text
move to +15
→ predicted state displayed
```

### Offline

```text
disconnect mock realtime
→ status reconnecting/stale
→ old data remains visible
```

### Reconnect

```text
restore
→ REST resync
→ ONLINE
```

---

## 9. Visual regression

Screenshot tests минимум:

```text
overview-1440x900
analytics-1440x900
flow-1440x900
```

Отдельный deterministic visual-test mode:

```env
VITE_VISUAL_TEST_MODE=true
```

Он отключает/фиксирует:

- ticking clock;
- random data;
- non-deterministic animations;
- automatic map fly transitions.

---

## 10. Map screenshot strategy

Онлайн tiles могут обновляться и ломать pixel-perfect comparison.

Для стабильных screenshot tests:

1. использовать локальный deterministic basemap; либо
2. маскировать/игнорировать область basemap и проверять overlays + UI.

Проверяем нашу систему, а не внешний map provider.

---

## 11. Browser matrix

Обязательно:

```text
Chromium
```

Желательно:

```text
Firefox
WebKit
```

---

## 12. CI gates

PR не merge, если не проходят:

```text
TypeScript typecheck
ESLint
unit tests
component tests
build
critical Playwright E2E
```

Visual regression можно вынести в отдельный workflow, но перед demo он обязателен.

---

## 13. Что не нужно чрезмерно тестировать

На хакатоне не тратить время на 100% coverage.

Приоритет:

```text
contracts > data flow > realtime > main user flows > visual regressions
```

а не покрытие каждого CSS utility.

---

## 14. Источники

- Vitest: https://vitest.dev/guide/
- Playwright: https://playwright.dev/docs/intro
- MSW: https://mswjs.io/

## Визуальная редакция v2

Добавить intro screenshot и проверку входа; обновить эталоны overview/analytics/flow под светлую композицию. Проверить прямые ссылки, reduced motion, WebGL failure, keyboard focus и мобильный экран. Старые тёмные screenshots не являются эталоном.
