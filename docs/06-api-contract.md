# Transit Control — REST API Contract

## 1. Общие правила

Base URL:

```text
/api/v1
```

REST является источником authoritative snapshot.

WebSocket передаёт incremental updates, но после reconnect frontend всегда может восстановить состояние через REST.

Backend публикует:

```text
/openapi.json
```

Frontend client/types/query hooks генерируются из OpenAPI через Orval.

---

## 2. Common types

```ts
export type RiskLevel =
  | 'normal'
  | 'elevated'
  | 'high'
  | 'critical';

export type VehicleStatus =
  | 'active'
  | 'stopped'
  | 'inactive'
  | 'unknown';

export type AlertSeverity =
  | 'info'
  | 'warning'
  | 'high'
  | 'critical';
```

---

## 3. Units / format

Используем явные единицы в именах полей:

```text
delay_sec
distance_m
speed_kmh
bearing_deg
horizon_min
```

Вероятности: `0.0–1.0`.

Время: ISO 8601 UTC:

```text
2026-09-21T15:24:00Z
```

GeoJSON coordinates:

```text
[longitude, latitude]
```

---

## 4. `GET /network/summary`

Response:

```json
{
  "timestamp": "2026-09-21T15:24:00Z",
  "vehicles_total": 356,
  "vehicles_active": 342,
  "routes_active": 48,
  "on_time_percent": 87.2,
  "at_risk_percent": 8.1,
  "delayed_percent": 4.7,
  "average_delay_sec": 144,
  "average_predicted_delay_sec": 288
}
```

---

## 5. `GET /vehicles`

Query params:

```text
bbox?
route_ids?
risk_levels?
status?
updated_after?
limit?
cursor?
```

`bbox` format:

```text
minLon,minLat,maxLon,maxLat
```

Response:

```json
{
  "items": [
    {
      "id": "vehicle-742",
      "route_id": "37",
      "position": {
        "lat": 55.7531,
        "lon": 37.6124
      },
      "bearing_deg": 124.3,
      "speed_kmh": 18.2,
      "current_delay_sec": 138,
      "predicted_delay_sec": 504,
      "risk_probability": 0.91,
      "risk_level": "critical",
      "status": "active",
      "next_stop": {
        "id": "stop-128",
        "name": "Ленинский проспект",
        "distance_m": 425
      },
      "updated_at": "2026-09-21T15:24:00Z"
    }
  ],
  "next_cursor": null
}
```

---

## 6. `GET /vehicles/{vehicleId}`

Возвращает подробную карточку одного ТС.

Большой GPS-history в этот endpoint не включать.

Для history использовать отдельный endpoint при необходимости:

```text
GET /vehicles/{id}/history?from=&to=
```

---

## 7. `GET /routes`

Query:

```text
risk_levels?
transport_type?
search?
```

Response:

```json
{
  "items": [
    {
      "id": "37",
      "number": "37",
      "name": "Северный вокзал — Университет",
      "transport_type": "bus",
      "current_delay_sec": 138,
      "predicted_delay_sec": 504,
      "risk_probability": 0.91,
      "risk_level": "critical",
      "vehicle_count": 12
    }
  ]
}
```

---

## 8. `GET /routes/{routeId}`

```json
{
  "id": "37",
  "number": "37",
  "name": "Северный вокзал — Университет",
  "current_delay_sec": 138,
  "predicted_delay_sec": 504,
  "risk_probability": 0.91,
  "risk_level": "critical",
  "vehicle_count": 12,
  "stops": [
    {
      "id": "stop-1",
      "name": "Северный вокзал",
      "sequence": 1
    }
  ]
}
```

---

## 9. `GET /routes/{routeId}/geometry`

GeoJSON Feature:

```json
{
  "type": "Feature",
  "properties": {
    "route_id": "37"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [37.61, 55.75],
      [37.62, 55.76]
    ]
  }
}
```

---

## 10. `GET /routes/{routeId}/segments`

Нужен для data-driven окраски маршрута.

```json
{
  "items": [
    {
      "id": "segment-1",
      "route_id": "37",
      "geometry": {
        "type": "LineString",
        "coordinates": []
      },
      "current_delay_sec": 120,
      "predicted_delay_sec": 420,
      "risk_probability": 0.86,
      "risk_level": "high"
    }
  ]
}
```

---

## 11. `GET /alerts`

Query:

```text
severity?
route_id?
vehicle_id?
active_only=true
limit=50
```

Response:

```json
{
  "items": [
    {
      "id": "alert-123",
      "severity": "critical",
      "type": "predicted_delay",
      "title": "Высокий риск задержки",
      "description": "Маршрут 37",
      "route_id": "37",
      "vehicle_id": "vehicle-742",
      "risk_probability": 0.91,
      "predicted_delay_sec": 504,
      "created_at": "2026-09-21T15:22:00Z"
    }
  ]
}
```

---

## 12. `GET /analytics/delay-series`

Query:

```text
from
to
bucket=1m|5m|15m
route_id?
```

Response:

```json
{
  "points": [
    {
      "timestamp": "2026-09-21T15:00:00Z",
      "actual_delay_sec": 120,
      "predicted_delay_sec": 160
    }
  ]
}
```

---

## 13. `GET /analytics/risk-distribution`

```json
{
  "normal": 36,
  "elevated": 8,
  "high": 3,
  "critical": 1
}
```

---

## 14. `GET /analytics/top-routes`

Query:

```text
metric=predicted_delay
limit=10
```

Response: список route summary, отсортированный backend.

---

## 15. `GET /forecast`

Query:

```text
horizon_min=15
```

Response:

```json
{
  "generated_at": "2026-09-21T15:24:00Z",
  "horizon_min": 15,
  "routes": [],
  "vehicles": [],
  "segments": []
}
```

---

## 16. `GET /forecast/vehicles/{id}`

```json
{
  "vehicle_id": "vehicle-742",
  "points": [
    {
      "offset_sec": 0,
      "predicted_delay_sec": 138,
      "risk_probability": 0.41
    },
    {
      "offset_sec": 300,
      "predicted_delay_sec": 288,
      "risk_probability": 0.63
    },
    {
      "offset_sec": 900,
      "predicted_delay_sec": 504,
      "risk_probability": 0.91
    }
  ]
}
```

---

## 17. Error response

Единый формат:

```json
{
  "error": {
    "code": "ROUTE_NOT_FOUND",
    "message": "Route was not found",
    "request_id": "req-123"
  }
}
```

HTTP semantics:

```text
200 success
400 invalid request
404 not found
409 state conflict
422 validation error
500 internal error
503 temporarily unavailable
```

---

## 18. API versioning

Breaking changes требуют новой версии:

```text
/api/v2
```

Нельзя незаметно менять семантику существующего поля.

---

## 19. Frontend generation policy

Frontend не поддерживает вручную копию backend DTO.

Workflow:

```text
backend changes schema
        ↓
update contracts/openapi.json
        ↓
pnpm api:generate
        ↓
TypeScript compile reveals integration issues
```

Generated files не исправляются вручную: исправляется OpenAPI или adapter.

---

## 20. Источник

Orval: https://orval.dev/
