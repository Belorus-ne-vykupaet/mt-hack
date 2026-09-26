# Автобусные маршруты демонстрации

Геометрия дорог и остановки: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Производная база данных OSM; сохраняйте атрибуцию и условия ODbL. Дата снимка записана в `moscow-buses.json`.

Фоновая карта в браузере использует публичные стили и тайлы [OpenFreeMap](https://openfreemap.org/quick_start/) через MapLibre; сервис публикует [условия использования и требования к атрибуции](https://openfreemap.org/tos/). Атрибуция OpenMapTiles и OpenStreetMap отображается непосредственно на карте. Работа фона требует интернет-доступа; это не источник признаков ML.

- Автобус м3: Проспект Будённого — Серебряный Бор — [OSM 3132036](https://www.openstreetmap.org/relation/3132036).
- Автобус с344: Метро «Охотный Ряд» — 1-й Силикатный проезд — [OSM 3187416](https://www.openstreetmap.org/relation/3187416).
- Автобус е70: Волгоградский проспект, МКАД — Метро «Китай-город» — [OSM 1807493](https://www.openstreetmap.org/relation/1807493).
- Автобус м6: Дангауэровка — Стадион «Лужники» — [OSM 2563942](https://www.openstreetmap.org/relation/2563942).
- Автобус м40: Лобненская улица — Метро «Китай-город» — [OSM 2793930](https://www.openstreetmap.org/relation/2793930).
- Автобус 370: Белорусский вокзал — Братцево — [OSM 2014616](https://www.openstreetmap.org/relation/2014616).
- Автобус 345: Белорусский вокзал — Метро «Бульвар Генерала Карбышева» — [OSM 2547312](https://www.openstreetmap.org/relation/2547312).
- Автобус т78: 9-я Северная линия — Белорусский вокзал — [OSM 2556866](https://www.openstreetmap.org/relation/2556866).
- Автобус м3к: Метро «Лубянка» — Проспект Будённого — [OSM 2563935](https://www.openstreetmap.org/relation/2563935).
- Автобус 116: Новозаводская улица — Белорусский вокзал — [OSM 3145472](https://www.openstreetmap.org/relation/3145472).
- Автобус м1: Метро «Новаторская» — Больница РЖД — [OSM 3228821](https://www.openstreetmap.org/relation/3228821).
- Автобус 418: Метро «Рижская» — Стрельбищенский переулок — [OSM 3241076](https://www.openstreetmap.org/relation/3241076).
- Автобус м34: Метро «Филёвский парк» — Белорусский вокзал — [OSM 3241398](https://www.openstreetmap.org/relation/3241398).
- Автобус м90: Метро «Беляево» — Метро «Лубянка» — [OSM 3249232](https://www.openstreetmap.org/relation/3249232).
- Автобус 384: Белорусский вокзал — Савёловский вокзал — [OSM 3265933](https://www.openstreetmap.org/relation/3265933).

Линии собраны из связных дорожных узлов отношений `route=bus`. Остановки — `stop_position` этих отношений; прямые перемычки через разрывы не создаются. В том числе есть автобусные маршруты, обслуживаемые электробусами. Каталог содержит одно направление каждого маршрута; это снимок OSM, а не расписание перевозчика. Положение автобусов, задержки и прогнозы синтетические.

`admin/data/bus-network.json` — граф дорог для добавления маршрутов по остановкам, не входит в публичную сборку.

## Справочные трассы официального архива

`public/data/official-road-routes.json` — производная картографическая база из официальных `test/schedule.csv` и `test/traffic.csv` с дорожной геометрией © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Дорожный путь рассчитан [OSRM](https://project-osrm.org/) на основе графа OSM; при публикации и переработке сохраняйте атрибуцию OSM и соблюдайте ODbL. Скрипт предрасчёта: `scripts/build-official-road-routes.py`. Это архивная справочная трасса, **не** уже пройденный к текущему моменту путь автобуса и **не** вход модели задержек. Когда в данных нет надёжного движения, линия отсутствует; линия между разорванными участками не додумывается.
