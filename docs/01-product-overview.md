# Transit Control — Product Overview

## 1. Назначение продукта

**Transit Control** — диспетчерская веб-система для мониторинга наземного пассажирского транспорта и визуализации текущих и прогнозируемых отклонений от расписания.

Система должна помочь диспетчеру перейти от реактивного управления к проактивному:

- увидеть текущее состояние сети;
- определить маршруты и транспортные средства, где уже развивается отклонение;
- увидеть прогноз задержки на горизонте 10–15 минут;
- быстро перейти от сетевого уровня к конкретному маршруту, транспортному средству или проблемному сегменту.

Frontend разрабатывается **до появления реального backend/ML**, но сразу строится так, чтобы подключение FastAPI и реальных прогнозов не требовало переписывать страницы, карты и графики.

---

## 2. Целевая аудитория

Основной пользователь — диспетчер/оператор транспортной сети.

Он работает в условиях высокой информационной нагрузки, поэтому интерфейс должен отвечать на вопросы в порядке приоритета:

1. Где сейчас критическая ситуация?
2. Где ситуация ухудшается?
3. Что станет проблемой через 10–15 минут?
4. Какие маршруты/ТС требуют внимания в первую очередь?
5. Почему система считает ситуацию рискованной?

Интерфейс не должен заставлять диспетчера самостоятельно «собирать» картину из десятков несвязанных графиков.

---

## 3. Основные режимы

Новый вход `/`: студийная 3D-заставка с немедленным переходом в рабочую среду. Прямые рабочие ссылки её обходят. Актуальная визуальная спецификация: `00-design-direction-v2.md`; старый тёмный HUD отменён.


### 3.1. Обзор сети — `NETWORK OVERVIEW`

2D-карта города, вид сверху или почти сверху.

Используется для:

- отображения маршрутов;
- отображения положения транспортных средств;
- текущего статуса рейсов;
- отображения задержек по сегментам;
- критических событий;
- быстрого перехода к карточке маршрута/ТС.

Главный вопрос: **«Что происходит сейчас?»**

### 3.2. Аналитика — `ANALYTICS`

Dashboard из KPI, гистограмм, распределений и временных рядов.

Используется для:

- общей пунктуальности;
- средней задержки;
- прогноза задержки;
- распределения риска;
- top-проблемных маршрутов;
- сравнения факта и прогноза;
- анализа динамики сети.

Главный вопрос: **«Насколько серьёзна ситуация и как она развивается?»**

### 3.3. Потоки — `NETWORK FLOW`

Наклонённая 2.5D-карта с простыми экструзиями зданий, маршрутными линиями и анимированными trails.

Это **не photorealistic digital twin** и не сцена с детальными 3D-моделями автобусов.

Основные элементы:

- MapLibre 3D buildings через `fill-extrusion`;
- deck.gl `PathLayer` для маршрутов;
- deck.gl `TripsLayer` для trails;
- простые точки/иконки транспортных средств;
- яркие risk-segments;
- прогнозируемое распространение проблемы.

Главный вопрос: **«Где образуется проблема и как она распространяется по сети?»**

---

## 4. Основные сущности

Frontend оперирует доменными сущностями:

```text
NetworkSummary
Route
RouteSegment
Vehicle
Stop
Alert
Forecast
RiskArea
DelaySeries
```

### Route

```ts
export interface Route {
  id: string;
  number: string;
  name?: string;
  transportType: 'bus' | 'tram' | 'trolleybus' | 'other';
  currentDelaySec: number;
  predictedDelaySec: number;
  riskProbability: number;
  riskLevel: RiskLevel;
  activeVehicleCount: number;
}
```

### Vehicle

```ts
export interface Vehicle {
  id: string;
  routeId: string;
  position: { lat: number; lon: number };
  bearingDeg?: number;
  speedKmh?: number;
  currentDelaySec: number;
  predictedDelaySec: number;
  riskProbability: number;
  riskLevel: RiskLevel;
  updatedAt: string;
}
```

### Risk

```ts
export type RiskLevel =
  | 'normal'
  | 'elevated'
  | 'high'
  | 'critical';
```

После подключения backend frontend **не вычисляет бизнес-уровень риска самостоятельно**. Backend передаёт `riskProbability` и `riskLevel`, frontend визуализирует их.

---

## 5. Граница данных

### 5.1. Operational / ML data

Для обучения, feature engineering, inference и оценки используются **только разрешённые организаторами данные хакатона**:

- NDTP/эмулятор;
- CSV хакатона;
- расписание;
- labels;
- результаты разрешённых преобразований этих данных;
- outputs ML-моделей.

### 5.2. Cartographic data

Внешние картографические данные разрешены только для визуализации:

- OpenStreetMap;
- OpenFreeMap;
- OpenMapTiles;
- PMTiles;
- данные зданий/дорог в составе basemap.

Жёсткая архитектурная граница:

```text
OSM / basemap ──> visualization only
OSM / basemap -X-> ML feature pipeline
```

Нельзя без отдельного разрешения превращать basemap-атрибуты в ML-признаки (`road_class`, `speed_limit`, внешние пробки и т. п.).

---

## 6. MVP scope

Frontend MVP включает:

- app shell;
- 3 основных режима;
- 2D map;
- analytics dashboard;
- 2.5D/flow map;
- sidebar/header;
- alerts panel;
- выбор маршрута/ТС;
- prediction timeline;
- mock REST;
- mock realtime stream;
- REST integration layer;
- WebSocket integration layer;
- loading/offline/stale/error states;
- Docker build.

Не входят в MVP:

- авторизация/сложный RBAC;
- редактор расписания;
- редактор маршрутов;
- сложные 3D-модели транспорта;
- photorealistic city;
- конструктор BI;
- ML training UI.

---

## 7. Архитектурный принцип разработки

Frontend строится от контракта, а не от временных `fetch()`:

```text
OpenAPI contract
      ↓
Orval generated client
      ↓
TanStack Query
      ↓
DTO adapter
      ↓
Domain model
      ↓
UI
```

Realtime:

```text
WebSocket
   ↓
Realtime adapter
   ↓
TanStack Query cache
   ↓
UI
```

UI-state:

```text
Zustand
```

В React-компонентах запрещены прямые `fetch`, `axios.get` и ручное обслуживание server cache.

---

## 8. Основные UX-критерии

Пользователь должен:

- заметить critical alert за несколько секунд;
- открыть проблемный маршрут максимум за 1–2 действия;
- перейти `Alert → Route → Vehicle` без перезагрузки;
- видеть отличие факта от прогноза;
- понимать актуальность данных по `last update`/connection state;
- не терять текущую карту и фильтры при переключении режимов.

---

## 9. Внешние технические опоры

Не изобретаем собственный GIS/WebGL-движок.

Используем готовые механизмы:

- MapLibre GL JS — базовая карта/камера/векторные тайлы/3D extrusion;
- deck.gl — динамические WebGL-слои;
- ECharts — графики;
- TanStack Query — server state;
- Zustand — UI state;
- Orval — генерация API-клиента из OpenAPI;
- MSW — mocks на уровне HTTP;
- FastAPI WebSocket — realtime backend;
- AsyncAPI — формальный контракт событий.

### Ссылки

- MapLibre: https://maplibre.org/maplibre-gl-js/docs/
- deck.gl + MapLibre: https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre
- TripsLayer: https://deck.gl/docs/api-reference/geo-layers/trips-layer
- Orval: https://orval.dev/
