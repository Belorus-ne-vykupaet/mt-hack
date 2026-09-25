# Transit Control — Frontend Architecture

## 1. Рекомендуемый стек

```text
React
TypeScript
Vite

MapLibre GL JS
deck.gl

TanStack Query
Zustand

Apache ECharts

shadcn/ui
Lucide

Orval
MSW

Vitest
React Testing Library
Playwright
```

### Роли библиотек

- **TanStack Query** — server state, cache, retries, refetch, synchronization.
- **Zustand** — только локальный UI state.
- **Orval** — generated REST client/types/hooks из OpenAPI.
- **MSW** — HTTP mocks на уровне настоящего REST-контракта.
- **MapLibre + deck.gl** — GIS/rendering.
- **ECharts** — charts.

---

## 2. Главный архитектурный принцип

Разделяем:

```text
Transport DTO
Domain Model
UI Model / presentation
```

Backend DTO не должен разползаться по UI.

Data flow:

```text
REST / WS / MSW
      ↓
Transport DTO
      ↓
Adapter
      ↓
Domain Model
      ↓
TanStack Query cache
      ↓
Feature hooks/selectors
      ↓
Components
```

---

## 3. Структура проекта

```text
src/
├── app/
│   ├── App.tsx
│   ├── router/
│   ├── providers/
│   ├── realtime/
│   └── config/
│
├── pages/
│   ├── overview/
│   ├── analytics/
│   └── flow/
│
├── widgets/
│   ├── app-header/
│   ├── app-sidebar/
│   ├── network-map/
│   ├── alerts-panel/
│   ├── route-details/
│   ├── vehicle-details/
│   ├── prediction-timeline/
│   └── analytics-dashboard/
│
├── features/
│   ├── select-route/
│   ├── select-vehicle/
│   ├── select-time/
│   ├── filter-network/
│   └── search/
│
├── entities/
│   ├── route/
│   │   ├── api/
│   │   ├── model/
│   │   └── ui/
│   ├── vehicle/
│   ├── alert/
│   ├── stop/
│   └── forecast/
│
├── shared/
│   ├── api/
│   │   ├── generated/
│   │   ├── http/
│   │   └── schemas/
│   ├── map/
│   ├── ui/
│   ├── lib/
│   ├── config/
│   └── types/
│
├── mocks/
│   ├── handlers/
│   ├── fixtures/
│   ├── scenarios/
│   └── realtime/
│
└── styles/
```

---

## 4. Dependency direction

```text
app
↓
pages
↓
widgets
↓
features
↓
entities
↓
shared
```

Нижние слои не импортируют верхние.

Пример запрещённого dependency:

```text
shared → pages
```

---

## 5. Generated API

Папка:

```text
src/shared/api/generated/
```

полностью генерируется и **не редактируется вручную**.

Желательно баннер:

```ts
/* AUTO-GENERATED. DO NOT EDIT. */
```

Workflow:

```text
FastAPI /openapi.json
        ↓
      Orval
        ↓
TypeScript DTO + TanStack Query hooks + optional MSW mocks
```

---

## 6. DTO → Domain adapter

Generated DTO:

```ts
export interface VehicleDto {
  vehicle_id: string;
  route_id: string;
  lat: number;
  lon: number;
  delay_seconds: number;
}
```

Domain:

```ts
export interface Vehicle {
  id: string;
  routeId: string;
  position: { lat: number; lon: number };
  delaySec: number;
}
```

Adapter:

```ts
export const mapVehicleDto = (dto: VehicleDto): Vehicle => ({
  id: dto.vehicle_id,
  routeId: dto.route_id,
  position: {
    lat: dto.lat,
    lon: dto.lon,
  },
  delaySec: dto.delay_seconds,
});
```

Если backend меняет `delay_seconds`, UI не переписывается — меняется контракт/adapter.

---

## 7. Server state

Хранится в TanStack Query:

```text
network summary
vehicles
routes
route geometry
segments
alerts
analytics
forecast
```

Не хранить копию этих данных в Zustand.

---

## 8. UI state

Zustand:

```ts
export interface AppUiState {
  selectedRouteId: string | null;
  selectedVehicleId: string | null;
  viewMode: 'overview' | 'analytics' | 'flow';
  forecastOffsetMin: number;
  filters: NetworkFilters;
  rightPanel: 'alerts' | 'route' | 'vehicle' | null;
}
```

Допустимо хранить camera state/filters, если это улучшает навигацию между views.

---

## 9. Query keys

Централизовать:

```ts
export const queryKeys = {
  network: {
    summary: ['network', 'summary'] as const,
  },
  vehicles: {
    all: ['vehicles'] as const,
    list: (filters: VehicleFilters) =>
      ['vehicles', 'list', filters] as const,
    detail: (id: string) =>
      ['vehicles', 'detail', id] as const,
  },
  routes: {
    all: ['routes'] as const,
    detail: (id: string) =>
      ['routes', 'detail', id] as const,
  },
  alerts: {
    all: ['alerts'] as const,
  },
};
```

---

## 10. No chaotic fetch policy

В `pages`, `widgets`, `features`, UI entities запрещены:

```ts
fetch(...)
axios.get(...)
XMLHttpRequest
```

Правильно:

```ts
const { data } = useVehicles(filters);
```

Сетевой код допускается только в generated client / shared API infrastructure.

---

## 11. REST + WebSocket

REST:

- initial snapshot;
- resynchronization;
- analytical queries;
- detail screens;
- fallback/refetch.

WebSocket:

- position updates;
- alert lifecycle;
- route state changes;
- forecast refreshes;
- heartbeat.

WebSocket event должен обновлять TanStack Query cache:

```text
WS event
   ↓
queryClient.setQueryData()
   ↓
subscribed UI updates
```

Не создаём второй параллельный server-store.

---

## 12. Providers

`AppProviders`:

```text
ErrorBoundary
Router
QueryClientProvider
TooltipProvider
Theme/Design tokens
RealtimeProvider
```

`RealtimeProvider` не хранит все данные — только lifecycle connection и bridge к query cache.

---

## 13. Error isolation

Минимум:

```text
AppErrorBoundary
MapErrorBoundary
ChartErrorBoundary
```

Ошибка одного chart/map-layer не должна полностью сносить dashboard.

---

## 14. Environment config

Все env читаются и валидируются централизованно:

```ts
export interface AppConfig {
  apiUrl: string;
  wsUrl: string;
  mapStyleUrl: string;
  dataSource: 'mock' | 'api';
  mockScenario: string;
}
```

Компоненты не обращаются напрямую к `import.meta.env`.

---

## 15. Источники

- TanStack Query: https://tanstack.com/query/latest
- Zustand: https://zustand.docs.pmnd.rs/
- Orval: https://orval.dev/
- MSW: https://mswjs.io/

## Intro v2

Заставка — отдельный лениво загружаемый маршрут `/`. Оригинальная процедурная сцена Three.js. Dashboard, MSW и realtime стартуют при входе в рабочую среду. При выходе с заставки renderer, geometry, materials, observers и animation frame освобождаются. Компоненты рабочей среды сохраняют API/domain boundaries.
