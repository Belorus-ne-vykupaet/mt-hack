# Документация Transit Control

Для основного этапа хакатона начните с [инструкции для жюри](../JURY_QUICKSTART.md) и [матрицы доказательств по критериям](22-criteria-evidence.md). [HTML PyDoc](../public/docs/python/index.html) собран из текущих Python-модулей командой `PYTHONPATH=ml:src ml/.venv/bin/python scripts/build-python-docs.py`; после запуска сайта он доступен по `/docs/python/`. [Причинный аудит предупреждений](21-early-warning-evidence.md) и [замеры устойчивости](20-reliability-benchmark.md) отделяют измеренные результаты от непроверенных предположений.

Текущая визуальная редакция: **v2 / 21 сентября 2026**.

Начать с [нового арт-направления и референсов](00-design-direction-v2.md), затем [UX/UI](02-ux-ui-spec.md), [экранов](03-screen-specifications.md) и [дизайн-системы](09-design-system.md).

Контракты данных и архитектура первого MVP сохраняются. Требования старого тёмного интерфейса заменены светлой студийной композицией и оригинальной 3D-заставкой.

## Подготовка к хакатону и управление

- [Тестовые CSV и адаптер полей](../admin/csv/README.md).
- [Исследование условия и источников данных](14-hackathon-research.md).
- [Выпуск автобусов, стоянки и внешние API](15-dispatch-and-external-data.md).
- [Автоподсказки и схема ML-рекомендаций](16-dispatch-recommendations-ml.md).
- [Работающий API, ML-коннектор и внешние сервисы](../server/README.md).
