# Transit Control — Development Guide & Definition of Done

## Часть A. Development Guide

### 1. Prerequisites

Рекомендуется единая среда:

```text
Node.js 22 LTS
pnpm
Git
Docker
```

`.nvmrc`:

```text
22
```

В репозитории один package manager — `pnpm`.

Commit:

```text
pnpm-lock.yaml
```

---

### 2. Bootstrap проекта

```bash
pnpm create vite transit-control --template react-ts
```

Core dependencies:

```bash
pnpm add \
  react \
  react-dom \
  react-router-dom \
  maplibre-gl \
  @deck.gl/core \
  @deck.gl/react \
  @deck.gl/maplibre \
  @deck.gl/layers \
  @deck.gl/geo-layers \
  @deck.gl/aggregation-layers \
  @deck.gl/widgets \
  @tanstack/react-query \
  zustand \
  echarts \
  h3-js \
  lucide-react
```

Dev dependencies:

```bash
pnpm add -D \
  orval \
  msw \
  vitest \
  @testing-library/react \
  @testing-library/jest-dom \
  @playwright/test \
  eslint \
  prettier
```

---

### 3. shadcn/ui

```bash
pnpm dlx shadcn@latest init
```

Компоненты:

```bash
pnpm dlx shadcn@latest add \
  button badge tabs tooltip popover sheet slider \
  skeleton separator command scroll-area
```

---

### 4. Environment

`.env.example`:

```env
VITE_DATA_SOURCE=mock
VITE_API_URL=http://localhost:8000/api/v1
VITE_WS_URL=ws://localhost:8000/api/v1/stream
VITE_MAP_STYLE_URL=https://example/style.json
VITE_MOCK_SCENARIO=route-37-delay
VITE_DEBUG=false
```

Все env валидируются в одном модуле, например `src/shared/config/env.ts`.

Запрещено обращаться к `import.meta.env.*` по всему приложению.

---

### 5. Orval

`orval.config.ts`:

```ts
import { defineConfig } from 'orval';

export default defineConfig({
  transit: {
    input: {
      target: './contracts/openapi.json',
    },
    output: {
      mode: 'tags-split',
      target: './src/shared/api/generated/endpoints.ts',
      schemas: './src/shared/api/generated/models',
      client: 'react-query',
      httpClient: 'fetch',
      mock: true,
      clean: true,
    },
  },
});
```

Generated code commit'ится, но не редактируется вручную.

---

### 6. Scripts

`package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "api:generate": "orval",
    "test": "vitest",
    "test:run": "vitest run",
    "test:e2e": "playwright test",
    "check": "pnpm typecheck && pnpm lint && pnpm test:run && pnpm build"
  }
}
```

---

### 7. API contract workflow

```text
Backend меняет FastAPI schema
        ↓
обновляем contracts/openapi.json
        ↓
pnpm api:generate
        ↓
TypeScript показывает breaking integration
        ↓
обновляем adapter/UI только где реально нужно
```

Generated code не чинить руками.

---

### 8. Mock startup

```ts
async function bootstrap() {
  if (config.dataSource === 'mock') {
    const { enableMocks } = await import('@/mocks/enableMocks');
    await enableMocks();
  }

  renderApp();
}

bootstrap();
```

---

### 9. Query client

Один на приложение:

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 2,
    },
  },
});
```

Конкретные queries могут переопределять `staleTime`.

---

### 10. Realtime startup

```text
App mounted
   ↓
REST initial snapshot
   ↓
RealtimeClient.connect()
   ↓
WS events patch TanStack Query cache
```

---

### 11. Docker

Multi-stage:

```dockerfile
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN corepack enable
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

`nginx.conf`:

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

---

### 12. Docker Compose

Минимально:

```text
frontend
backend
```

Опционально:

```text
local-map / PMTiles server
```

если карта не раздаётся статически самим frontend/nginx.

---

### 13. Git / PR rules

Branches:

```text
main
feature/*
fix/*
```

Перед merge:

```bash
pnpm check
```

No-shortcuts rule: прямой `fetch('/api/...')` в component не допускается даже «временно».

---

## Часть B. Definition of Done

### 14. Project foundation

- [ ] React + TypeScript + Vite настроены.
- [ ] pnpm используется всей командой.
- [ ] Node version закреплена.
- [ ] TypeScript strict включён.
- [ ] ESLint/formatting работают.
- [ ] Docker image собирается.
- [ ] Production build запускается.

### 15. Architecture

- [ ] Server state хранится в TanStack Query.
- [ ] UI state хранится в Zustand.
- [ ] DTO отделены от domain models.
- [ ] Для DTO есть adapters.
- [ ] Generated API не редактируется вручную.
- [ ] Нет REST calls внутри UI components.
- [ ] Нет direct WebSocket handling внутри pages/widgets.

### 16. REST contract

- [ ] Есть `contracts/openapi.json`.
- [ ] `pnpm api:generate` работает.
- [ ] Query hooks типизированы.
- [ ] Error response унифицирован.
- [ ] Dates — ISO 8601.
- [ ] Units указаны в полях.
- [ ] Probability — `0..1`.

### 17. Realtime

- [ ] `RealtimeClient` определён.
- [ ] Есть `WebSocketRealtimeClient`.
- [ ] Есть `MockRealtimeClient`.
- [ ] Reconnect реализован.
- [ ] Heartbeat реализован.
- [ ] Stale state реализован.
- [ ] Sequence-gap вызывает resync.
- [ ] После reconnect выполняется REST snapshot.
- [ ] WS events patch TanStack Query cache.
- [ ] Есть AsyncAPI contract.

### 18. Mock

- [ ] Frontend запускается без backend.
- [ ] REST mock через MSW.
- [ ] Mock соответствует OpenAPI.
- [ ] Demo scenario детерминированный.
- [ ] `route-37-delay` работает целиком.
- [ ] Scenario можно reset/pause/play.

### 19. App shell

- [ ] Header.
- [ ] Sidebar.
- [ ] Main workspace.
- [ ] Right panel.
- [ ] Connection indicator.
- [ ] Last update.
- [ ] Search.
- [ ] Timeline.
- [ ] Mode switch.

### 20. Overview

- [ ] MapLibre загружается.
- [ ] 2D view.
- [ ] Маршруты отображаются.
- [ ] Vehicles — GPU layer.
- [ ] Risk colors работают.
- [ ] Vehicle selectable.
- [ ] Route selectable.
- [ ] Alert click фокусирует карту.
- [ ] Right panel показывает entity details.

### 21. Analytics

- [ ] Пунктуальность.
- [ ] Средняя current delay.
- [ ] Средняя predicted delay.
- [ ] Количество ТС/маршрутов.
- [ ] Delay histogram.
- [ ] Risk distribution.
- [ ] Actual vs forecast.
- [ ] Top routes.

### 22. Flow

- [ ] Tilted camera.
- [ ] Buildings через extrusion.
- [ ] Routes через deck.gl.
- [ ] TripsLayer работает.
- [ ] Vehicles отображаются.
- [ ] Current/forecast различаются.
- [ ] Selected route выделяется.
- [ ] Critical segments используют semantic neon.
- [ ] Detailed 3D buses не требуются.

### 23. Design

- [ ] Нет decorative blue-purple gradients.
- [ ] UI background светлый нейтральный.
- [ ] Семантические цвета контрастны на светлой карте.
- [ ] Severity palette едина.
- [ ] Typography едина.
- [ ] Одно icon family.
- [ ] Color не единственный carrier статуса.

### 24. Failure states

Проверены:

- [ ] initial loading;
- [ ] API unavailable;
- [ ] WS unavailable;
- [ ] reconnecting;
- [ ] stale data;
- [ ] empty alerts;
- [ ] route not found;
- [ ] map source unavailable;
- [ ] unknown realtime event.

### 25. Tests

- [ ] Adapters — unit tests.
- [ ] Cache patch logic — tests.
- [ ] Reconnect logic — tests.
- [ ] UI primitives — component tests.
- [ ] Overview — E2E.
- [ ] Analytics — E2E.
- [ ] Flow — E2E.
- [ ] Alert navigation — E2E.
- [ ] Offline/reconnect — E2E.
- [ ] Visual regression screenshots.

### 26. Performance

На 500 vehicles / 50 routes:

- [ ] map >= 30 FPS на target demo machine;
- [ ] нет заметных freeze при realtime;
- [ ] mode switch без reload;
- [ ] telemetry batch'ится;
- [ ] charts throttled;
- [ ] DOM markers не используются для всех ТС;
- [ ] trip history ограничена.

### 27. Data policy

- [ ] Basemap data отделены от ML data.
- [ ] OSM/OpenFreeMap используются только для visualization.
- [ ] Basemap не экспортируется в ML pipeline.
- [ ] Никакие внешние map attributes не становятся features без разрешения.
- [ ] Attribution сохранена.

### 28. Integration readiness

Переход:

```text
MOCK → REAL BACKEND
```

не должен требовать изменений в:

- pages;
- widgets;
- map components;
- charts;
- design system.

Разрешённые точки интеграции:

```text
OpenAPI contract
generated code
DTO adapters
realtime adapter
configuration
```

---

## 29. Финальная архитектурная схема

```text
                  Hackathon NDTP / CSV
                           │
                           ▼
                        Backend
                           │
                    ML / prediction
                           │
              ┌────────────┴─────────────┐
              │                          │
             REST                    WebSocket
              │                          │
              └────────────┬─────────────┘
                           ▼
                    API / realtime adapters
                           │
                           ▼
                  TanStack Query Cache
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
       Overview         Analytics         Flow
          │                │                │
     MapLibre +         ECharts       MapLibre +
       deck.gl                            deck.gl
```

Отдельно:

```text
OSM / OpenFreeMap / PMTiles
            │
            ▼
        BASEMAP ONLY
            │
            X
         ML pipeline
```

---

## 30. Рекомендуемый порядок реализации

```text
1. Repository + Vite + TypeScript
2. Design tokens + App Shell
3. OpenAPI draft
4. Orval generation
5. MSW
6. Domain adapters
7. Overview Map
8. Analytics
9. Flow Map
10. Mock realtime
11. WebSocket adapter
12. FastAPI integration
13. ML integration
```

Контракт и mock появляются **до** сложного UI. Это главный способ избежать хаотичного `fetch`-кода в последний день.

---

## 31. Источники

- deck.gl: https://deck.gl/
- MapLibre GL JS: https://maplibre.org/maplibre-gl-js/docs/
- TanStack Query: https://tanstack.com/query/latest
- Zustand: https://zustand.docs.pmnd.rs/
- Orval: https://orval.dev/
- FastAPI WebSockets: https://fastapi.tiangolo.com/advanced/websockets/
- AsyncAPI: https://www.asyncapi.com/docs/concepts/asyncapi-document
- Vitest: https://vitest.dev/guide/
- Playwright: https://playwright.dev/docs/intro

## Дополнение v2: visual acceptance

- [ ] Авторская 3D-заставка `/` и немедленный вход в диспетчерскую.
- [ ] Прямые рабочие ссылки обходят intro.
- [ ] Композиция упрощена: одна основная область и контекстная панель.
- [ ] Светлая оболочка, крупная типографика, лаймовый брендовый акцент.
- [ ] Существующие функции сохранены.
- [ ] Актуальная документация и промежуточные результаты отправляются в GitHub.
