# Transit Control — Performance Requirements

## 1. Цель

Dashboard должен оставаться интерактивным при постоянных telemetry updates и большом количестве map objects.

Целевой профиль MVP:

```text
500 vehicles
50 routes
100 active alerts
несколько тысяч route points
```

Stretch:

```text
2,000 vehicles
100 routes
```

---

## 2. FPS

Map interaction:

```text
target: 60 FPS
acceptable demo floor: 30 FPS
```

Нельзя допускать видимых freeze при приходе realtime batch.

---

## 3. GPU layers вместо DOM markers

Запрещён паттерн:

```text
500 React <Marker />
```

Использовать deck.gl layers:

- `ScatterplotLayer`;
- `IconLayer`;
- `PathLayer`;
- `TripsLayer`.

---

## 4. Realtime update cadence

Backend может присылать telemetry часто, но UI не обязан визуально обновлять всё с той же частотой.

Рекомендуемый budget:

```text
vehicle map      5–10 Hz
KPI              1–2 Hz
charts           ~1 Hz
```

События не теряются: realtime adapter агрегирует последние значения перед render update.

---

## 5. Last-write-wins для координат

Если за 100 ms пришли:

```text
Vehicle 742: A
Vehicle 742: B
Vehicle 742: C
```

в следующий render нужен C.

Нет смысла отрисовывать A/B, если пользователь физически не увидит их.

---

## 6. Stable data references

Не создавать новые большие arrays на каждый React render.

Плохо:

```ts
const layerData = vehicles.map(v => ({ ...v }));
```

в render без memoization/необходимости.

Mapping выполнять:

- adapter layer;
- query `select`;
- memoized selector.

---

## 7. Route geometry

Route geometry относительно статична.

Не refetch/rebuild на каждый vehicle event.

Хранить отдельно от volatile route state.

Можно иметь:

```text
routes metadata query
route geometry query/cache
vehicles query
```

---

## 8. Trips history

Не хранить бесконечный GPS-history в браузере.

Для визуального trail достаточно:

```text
30 sec – 5 min
```

в зависимости от zoom/view.

Полная история, если понадобится, запрашивается отдельно.

---

## 9. Forecast interpolation

Не пересчитывать ML/probability на frontend.

Frontend получает forecast snapshot и только интерполирует визуальное состояние между известными временными точками при playback.

---

## 10. ECharts update

Не вызывать `setOption()` 20 раз/сек для KPI charts.

Charts обновлять throttled/batched.

Realtime marker motion может быть чаще, analytics — реже.

---

## 11. Layer lifecycle

Heavy layer включается только в нужном view.

Например:

```text
Overview: routes + vehicles + alerts
Flow: buildings + routes + trips + vehicles
Analytics: no full map renderer
```

---

## 12. Lazy loading

Analytics/Flow page bundles можно lazy-load:

```ts
const AnalyticsPage = lazy(() => import('./AnalyticsPage'));
const FlowPage = lazy(() => import('./FlowPage'));
```

Map/analytics dependencies не обязаны входить в первый экран одновременно, если это заметно влияет на startup.

---

## 13. Assets

Не включать в bundle:

- тяжёлые 3D bus models;
- большие videos;
- неиспользуемые icon packs;
- огромные растровые backgrounds.

---

## 14. Hexagon performance

Если используется spatial risk visualization, `HexagonLayer` поддерживает GPU aggregation. Не писать CPU hex aggregation в React render.

Для H3 фиксированные cell IDs можно получать заранее на backend/data-adapter уровне.

---

## 15. Profiling

Перед demo проверить:

- Chrome Performance;
- React Profiler;
- FPS во время map pan/zoom;
- CPU usage во время mock stream;
- memory growth за 10–15 минут работы.

Особенно проверить отсутствие утечки trip-history/listeners.

---

## 16. Acceptance criteria

При 500 vehicles / 50 routes:

- карта остаётся интерактивной;
- realtime updates не блокируют main thread на заметные интервалы;
- mode switch не требует reload;
- нет multi-second UI freeze;
- reconnect/resync не замораживает интерфейс;
- память не растёт бесконечно из-за history/events.

---

## 17. Источники

- deck.gl performance-friendly GPU layers: https://deck.gl/
- HexagonLayer: https://deck.gl/docs/api-reference/aggregation-layers/hexagon-layer
- TripsLayer: https://deck.gl/docs/api-reference/geo-layers/trips-layer

## Intro v2

Three.js загружается только на заставке. Ограничить devicePixelRatio до 1.5–2.0, снизить геометрию на mobile, остановить RAF при document.hidden и reduced motion. При переходе в рабочую среду освободить intro WebGL context. Не запускать заставку и карту параллельно.

## Проверка памяти карты — 24 сентября 2026

Исправлены удержания ресурсов при смене темы/режима и уходе с карты:

- В используемой версии deck.gl `finalize()` не освобождает наблюдатель собственного luma canvas context. `MediaQueryList → _handleDevicePixelRatioChange → canvas` удерживал удалённые WebGL-карты. При завершении экземпляра карты теперь явно вызываются finalize overlay и destroy его canvas context, до удаления MapLibre. Контекст действующей карты не уничтожается при обычном переключении 2D/3D.
- Погодный слой освобождается до уничтожения общего GL-контекста и повторно безопасно очищается в React cleanup. Незавершённая генерация масок отменяется; уже созданные ImageBitmap закрываются.
- Функции загрузки погоды вынесены из компонента: кэш React Query больше не удерживает map через общее замыкание компонента.
- В аналитике карта размонтируется вместо скрытия работающего WebGL canvas.

Замер Chrome production preview с тестовым дождём, одним окном, сменой темы и 2D/3D, с принудительным GC через CDP: до исправления JS heap вырос примерно с 22 до 54 МиБ за 12 циклов, в снимке оставались 13 WebGL-контекстов. После исправления за 36 циклов после прогрева — около 31–35 МиБ. В финальном отдельном прогоне после ухода в аналитику — около 25 МиБ и ноль удерживаемых WebGL2-контекстов. Это JS heap конкретного прогона, не вся RAM/GPU-память Chrome; не замена длительному нагрузочному тесту.

Регрессии: `tests/e2e/weather.spec.ts` проверяет постоянное количество подписок resolution/visibility, смену темы/режима и отсутствие удерживаемых canvas после GC (WeakRef не удерживает их сам). `tests/weather-lifecycle.test.ts` проверяет закрытие асинхронно созданного bitmap при отмене. Погодные запросы в этих проверках подменены локальными ответами и не расходуют квоту.

Проверки этой правки: `pnpm check` — 74 теста, типы/lint/сборка прошли. Общий браузерный прогон — 38/39: проверка offline-плана диспетчера один раз не увидела состояние offline; отдельный повтор этого теста и теста очистки карты прошёл (2/2). Ошибка offline не воспроизвелась повторно, логика потока в этой правке не менялась.
