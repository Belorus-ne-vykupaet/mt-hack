# 3D-автобус

`bus.glb` — автобус из **Public Transport Pack**, автор **Quaternius**.

- Источник: https://quaternius.com/packs/publictransport.html
- Лицензия: CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/
- Оригинал: Bus.obj из OBJ-папки, доступной по ссылке Download на странице автора.
- Файл: https://drive.google.com/file/d/1jVrZEPeLP0Inr4oVurmKDF1vAbJwAIOp/view
- Изменения: конвертация OBJ → GLB, центрирование и нормализация осей/масштаба, синяя окраска кузова, тёмные окна и колёса. Скрипт: `scripts/prepare-bus-model.mjs`.

Модель хранится локально и не требует внешнего сервиса. Общая геометрия используется всеми автобусами; положение и направление следуют дорожной геометрии маршрута. Масштаб увеличен для читаемости. При ошибке загрузки остаются 2D-значки автобусов.
