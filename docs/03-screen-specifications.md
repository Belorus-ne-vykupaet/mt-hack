# Transit Control — Screen Specifications v2

Актуальная визуальная система: [Visual direction v2](00-design-direction-v2.md).

## Экран INTRO `/`

Светлая полноэкранная композиция, оригинальная WebGL-скульптура транспортного потока, крупная фраза «Город. В движении.», действие «Открыть диспетчерскую». Вход работает при недоступной 3D-сцене. Прямые `/overview`, `/analytics`, `/flow` открывают рабочую среду сразу.


## 1. Экран `NETWORK OVERVIEW`

Route: `/overview` (или `/` с redirect).

### Цель

Ответить на вопрос: **«Что происходит с транспортом прямо сейчас?»**

### Layout v2

Светлая рабочая среда. Верхняя строка — крупное название и краткая сводка. Основное пространство — карта; справа одна контекстная панель событий/выбранного объекта. Повторяющиеся графики перенесены в Analytics. Поиск и фильтры компактны. Timeline находится под картой.

### Network status

```text
Текущее состояние сети

87%      8%      5%
по граф.  риск    задержка

342 ТС
48 маршрутов
```

### Delay trend

ECharts line chart:

- X = time;
- Y = average delay;
- fact = solid;
- forecast = dashed.

ECharts динамически обновляется через `setOption()`; отдельный chart-engine писать не нужно.

### Main map

Default camera:

```ts
{
  pitch: 0,
  bearing: 0,
  zoom: 11
}
```

Допустимый небольшой pitch: `0–10°`.

#### Map layer order

```text
basemap
road labels
route base
route risk segments
vehicles
alerts
selection
custom labels
```

#### Routes

Обычный:

```text
width: 2px
opacity: 0.35–0.5
```

Selected:

```text
width: 4–6px
opacity: 1
```

Risk-segment palette:

```text
normal     green
elevated   yellow
high       orange
critical   red
```

#### Vehicles

При zoom-out — `ScatterplotLayer`.

При zoom-in — `IconLayer`.

Не использовать сотни DOM `<Marker />`.

Tooltip:

```text
ТС 742
Маршрут 37

Скорость: 18 км/ч
Сейчас: +2.3 мин
Через 15 мин: +8.4 мин
Риск: 91%
```

### Alerts panel

Максимум 5–8 видимых событий.

Карточка:

```text
CRITICAL
Маршрут 37                         91%
Затор / растущий риск

Сейчас:   +2.3 мин
+15 мин:  +8.4 мин
2 мин назад
```

Сортировка:

```text
severity DESC
risk DESC
createdAt DESC
```

---

## 2. Экран `ANALYTICS`

Route: `/analytics`.

### Цель

Ответить: **«Насколько серьёзна ситуация и как она развивается?»**

### Layout

```text
┌──────────────────────────────────────────────────┐
│ KPI  KPI  KPI  KPI                               │
├──────────────────────────┬───────────────────────┤
│ DELAY HISTOGRAM          │ RISK DISTRIBUTION     │
├──────────────────────────┼───────────────────────┤
│ ACTUAL VS FORECAST       │ TOP ROUTES            │
└──────────────────────────┴───────────────────────┘
```

### KPI

Минимум:

- Пунктуальность;
- Средняя текущая задержка;
- Средний прогноз +15 минут;
- Активные ТС;
- Активные маршруты.

### Delay histogram

```text
          ██
       █████
     ███████
   █████████
█████████████
────────────────
06 09 12 15 18 21
```

Bars окрашиваются по semantic категории риска. Не использовать декоративный gradient.

### Risk distribution

Предпочтительно horizontal stacked bar:

```text
████████████████████████████████
NORMAL | ELEVATED | HIGH | CRITICAL
```

Donut допустим как вторичный вариант.

### Actual vs forecast

```text
delay
  │
8 │                       - - - -
6 │                 _____/
4 │       __________/
2 │______/
  └──────────────────────────────
                  NOW
```

Слева — факт; справа — прогноз.

### Top routes

```text
1  Маршрут 37  █████████████  +8.4 мин
2  Маршрут 42  █████████      +6.1 мин
3  Маршрут 24  ███████        +4.2 мин
4  Маршрут 17  ██████         +3.8 мин
```

Click по строке → выбрать route и открыть details.

---

## 3. Экран `NETWORK FLOW`

Route: `/flow`.

### Цель

Ответить: **«Где образуется проблема и как она распространяется?»**

### Camera

Default:

```ts
{
  pitch: 50,
  bearing: -15,
  zoom: 12
}
```

Pitch range: `35–60°`.

### Buildings

MapLibre `fill-extrusion`.

Пример:

```js
{
  'fill-extrusion-color': '#d8ddd1',
  'fill-extrusion-opacity': 0.65
}
```

Здания — фон. Они не должны конкурировать с маршрутами.

### Route flow

`PathLayer`:

- normal route — приглушённый;
- selected route — 4–6px;
- risk-segment — контрастный семантический цвет;
- остальные маршруты при selection — opacity ~0.2.

### Trails

`TripsLayer`:

```text
────────────●
trail       current vehicle
```

`trailLength` для MVP: 30–120 секунд визуальной истории.

### Prediction

Timeline:

```text
NOW → +3 → +6 → +10 → +15
```

Current и predicted состояния должны визуально отличаться.

Например:

```text
CURRENT     solid
FORECAST    dashed / glow / separate alpha
```

---

## 4. Route Details panel

```text
Маршрут 37
Северный вокзал → Университет

Текущая задержка   +2.3 мин
Прогноз +15        +8.4 мин
Риск               91%
ТС на маршруте     12

Проблемные остановки
Ленинский проспект +6.8
Университет        +7.9
```

Tabs optional:

```text
Обзор | Остановки | ТС | Прогноз
```

---

## 5. Vehicle Details panel

```text
ТС 742
Маршрут 37
HIGH RISK

Скорость              18 км/ч
Текущая задержка      +2.3 мин
Через 15 минут        +8.4 мин
Следующая остановка   Ленинский проспект
```

После ML explainability:

```text
Основные факторы

Текущая задержка       34%
Снижение скорости      26%
Длительная остановка   22%
Плотность потока       18%
```

UI готовит место под explainability заранее, но не генерирует эти причины сам.

---

## 6. Общие состояния каждого экрана

Обязательны:

- loading;
- empty;
- partial data;
- stale;
- offline;
- backend error;
- map source error;
- selected entity disappeared;
- unknown realtime event (не должен ломать UI).
