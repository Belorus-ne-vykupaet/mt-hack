# Transit Control — Map Architecture

## 1. Стек

```text
MapLibre GL JS
+
deck.gl
```

MapLibre отвечает за:

- basemap;
- vector tiles;
- camera;
- labels;
- roads;
- buildings;
- базовые map controls.

deck.gl отвечает за:

- vehicles;
- routes;
- risk segments;
- animated trips/trails;
- H3/hexbin layers;
- GPU picking.

Официальная интеграция deck.gl рекомендует `MapLibreOverlay`. При `interleaved: true` слои deck.gl используют WebGL2-контекст MapLibre и могут корректно смешиваться с map layers и labels.

---

## 2. Картографические данные

Для visual basemap допускаются внешние картографические данные.

Рекомендуется:

### Development

- OpenFreeMap/OpenStreetMap-compatible vector tiles.

### Demo / offline fallback

- PMTiles/self-hosted tiles.

Причина: презентация не должна зависеть от Wi-Fi площадки.

Картографические данные используются **только для визуализации** и не передаются в ML pipeline.

---

## 3. Один map engine

Не создавать полностью независимые `OverviewMap` и `FlowMap`.

Использовать один `MapRoot` с различными layer/camera presets:

```text
MapRoot
│
├── MapLibre basemap
│
└── MapLibreOverlay
    ├── routes
    ├── risk segments
    ├── vehicles
    ├── trips
    └── selections
```

Так сохраняются центр, выбранный объект и фильтры при переключении view.

---

## 4. Map modes

```ts
export type MapMode = 'overview' | 'flow';
```

Analytics использует charts и не обязан держать полноразмерный map renderer.

### Overview preset

```ts
{
  pitch: 0,
  bearing: 0,
  zoom: 11
}
```

### Flow preset

```ts
{
  pitch: 50,
  bearing: -15,
  zoom: 12
}
```

При переключении не сбрасывать center без необходимости.

---

## 5. Route layer

Использовать deck.gl `PathLayer`.

Концепт:

```ts
new PathLayer<Route>({
  id: 'routes',
  data: routes,
  getPath: route => route.coordinates,
  getColor: route => getRouteColor(route),
  getWidth: route => route.id === selectedRouteId ? 5 : 2,
  widthUnits: 'pixels',
  pickable: true,
});
```

Route geometry хранить в `[longitude, latitude]`.

---

## 6. Vehicle layer

### Zoom-out

`ScatterplotLayer` — небольшие точки.

### Zoom-in

`IconLayer` — простые пиктограммы.

Не использовать detailed 3D bus assets в MVP.

Причины:

- лишний asset pipeline;
- ориентация и lighting;
- GPU нагрузка;
- мало продуктовой пользы на уровне городской сети.

---

## 7. TripsLayer

Для flow-view использовать `TripsLayer`.

```ts
new TripsLayer({
  data: vehicleTrips,
  getPath: trip => trip.path,
  getTimestamps: trip => trip.timestamps,
  currentTime,
  trailLength: 90,
  getColor: trip => getRiskColor(trip.riskLevel),
});
```

Документация deck.gl отдельно предупреждает, что timestamps хранятся с float32-precision и длинные Unix timestamps нужно нормализовать.

Использовать:

```ts
normalized = sourceTimestampMs - sessionStartTimestampMs;
```

а не raw epoch в accessor.

---

## 8. Buildings

Отдельная 3D-модель Москвы не нужна.

MapLibre умеет `fill-extrusion` по building polygons.

Пример:

```json
{
  "id": "3d-buildings",
  "type": "fill-extrusion",
  "source": "basemap",
  "source-layer": "building",
  "minzoom": 12,
  "paint": {
    "fill-extrusion-color": "#d8ddd1",
    "fill-extrusion-height": [
      "coalesce",
      ["get", "height"],
      8
    ],
    "fill-extrusion-base": [
      "coalesce",
      ["get", "min_height"],
      0
    ],
    "fill-extrusion-opacity": 0.65
  }
}
```

Здания — контекст, не главный визуальный объект.

---

## 9. Basemap style

Показывать:

- water;
- major roads;
- district labels;
- transport-relevant labels;
- buildings.

Скрывать или сильно приглушать:

- shops;
- restaurants;
- tourism;
- retail POI;
- мелкие decorative labels.

---

## 10. Risk colors

Палитра ниже заменена v2 из `09-design-system.md`: normal #257b54, elevated #987000, high #c76816, critical #d74343. Selection — #466526.


```ts
export const riskColors = {
  normal: [37, 123, 84],
  elevated: [152, 112, 0],
  high: [199, 104, 22],
  critical: [215, 67, 67],
} as const;
```

Selected entity получает отдельный контрастный outline, при этом внутренний risk-color остаётся видимым.

---

## 11. Optional H3 risk landscape

Если вернётся пространственный risk-view:

```text
H3 + H3HexagonLayer
```

`H3HexagonLayer` уже поддерживает:

- `getHexagon`;
- `getFillColor`;
- `getElevation`;
- `extruded`;
- `pickable`.

Не писать свой hex-grid.

Если фиксированная H3-сетка не нужна, можно использовать `HexagonLayer`, который агрегирует points в hexbin и умеет GPU aggregation.

---

## 12. Performance rules карты

- не создавать сотни DOM markers;
- данные слоёв держать стабильными;
- не пересоздавать route geometry на каждый React render;
- realtime updates batch'ить;
- хранить ограниченный хвост trip history;
- charts и map update cadence разделять;
- heavy layer включать только в нужном view.

---

## 13. Attribution

При использовании OpenStreetMap/OpenFreeMap/OpenMapTiles сохранять обязательную attribution согласно лицензии источника.

Не скрывать attribution ради визуальной чистоты.

---

## 14. Источники

- deck.gl + MapLibre: https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre
- MapLibreOverlay: https://deck.gl/docs/api-reference/maplibre/overview
- TripsLayer: https://deck.gl/docs/api-reference/geo-layers/trips-layer
- H3HexagonLayer: https://deck.gl/docs/api-reference/geo-layers/h3-hexagon-layer
- HexagonLayer: https://deck.gl/docs/api-reference/aggregation-layers/hexagon-layer
- MapLibre 3D buildings: https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/
