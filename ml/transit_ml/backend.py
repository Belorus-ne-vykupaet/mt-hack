"""Python orchestration: official CSV replay / NDTP reception -> causal features -> ML API."""

import asyncio
import json
import math
import os
import time
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pandas as pd
from fastapi import FastAPI

from .features import Dataset, seconds
from .ndtp import Receiver


def iso(ts):
    return pd.Timestamp(ts, unit="s", tz="UTC").isoformat().replace("+00:00", "Z")


def risk(delay):
    if delay < -60:
        return "elevated"
    return (
        "critical"
        if delay >= 420
        else "high"
        if delay >= 240
        else "elevated"
        if delay > 120
        else "normal"
    )


def finite(record):
    return {
        k: float(v) if pd.notna(v) and math.isfinite(v) else None
        for k, v in record.items()
    }


def stop(row, sequence=0):
    return {
        "id": str(row["tt_action_item_id"]),
        "name": str(row["building_address"])
        if pd.notna(row["building_address"])
        else f"Остановка {int(row['tt_action_item_id'])}",
        "sequence": sequence,
        "position": {"lon": float(row["lon"]), "lat": float(row["lat"])},
    }


class Engine:
    def __init__(self):
        self.root = Path(os.getenv("OFFICIAL_DATA_DIR", "ml/data/official"))
        self.dataset = Dataset(self.root / "test")
        # Only already observed actual arrivals <= T are used to derive current deviation in replay.
        actual = pd.read_csv(self.root / "test/schedule.csv")
        actual["actual_ts"] = seconds(actual.time_fact_begin)
        actual["plan_ts"] = seconds(actual.time_begin)
        self.actual = {
            int(k): v.sort_values("actual_ts").dropna(subset=["actual_ts"])
            for k, v in actual.groupby("tr_id")
        }
        self.plans = {int(k): v for k, v in self.dataset.schedule.groupby("tr_id")}
        self.started = time.monotonic()
        self.start = pd.Timestamp(
            os.getenv("REPLAY_START", "2026-01-06 17:50:00"), tz="UTC"
        ).timestamp()
        self.speed = float(os.getenv("REPLAY_SPEED", "1"))
        self.mode = os.getenv("TELEMETRY_MODE", "replay")
        if self.mode not in ("replay", "ndtp"):
            raise ValueError("TELEMETRY_MODE must be replay or ndtp")
        self.receiver = Receiver()
        self.cache = None
        self.cache_at = 0.0
        self.lock = asyncio.Lock()
        self.status = "starting"
        self.last_ms = 0.0
        self.last_error = None
        self.metrics = json.loads(
            Path(os.getenv("ML_ARTIFACTS", "ml/artifacts"), "metrics.json").read_text()
        )
        self.ml_url = os.getenv("ML_URL", "http://127.0.0.1:8092")
        self.last_ml_ms = None
        self.unit_map = {
            int(row.unit_id): int(row.tr_id)
            for row in self.dataset.traffic[["unit_id", "tr_id"]]
            .dropna()
            .drop_duplicates()
            .itertuples()
        }
        # Live data requires a matching current plan; no silent shifting of historical schedules.
        if self.mode == "ndtp" and os.getenv("LIVE_PLAN_DIR"):
            live = Path(os.environ["LIVE_PLAN_DIR"])
            self.dataset = Dataset(live)
            self.plans = {int(k): v for k, v in self.dataset.schedule.groupby("tr_id")}
            self.unit_map = {
                int(k): int(v)
                for k, v in json.loads((live / "unit-map.json").read_text()).items()
            }
        self.catalog = []
        self.geometry = []
        self.series = deque(maxlen=240)
        for tr, plan in self.plans.items():
            valid = plan[plan.lat.between(-90, 90) & plan.lon.between(-180, 180)]
            stops = [stop(row, i) for i, row in enumerate(valid.to_dict("records"))]
            self.catalog.append(
                {
                    "id": f"duty-{tr}",
                    "number": str(tr),
                    "name": f"План ТС {tr} · официальный CSV",
                    "transport_type": "bus",
                    "stops": stops,
                    "vehicle_count": 0,
                    "current_delay_sec": 0,
                    "predicted_delay_sec": 0,
                    "risk_probability": 0,
                    "risk_level": "normal",
                }
            )
            # No invented street geometry: empty line until a real trace is available.
            self.geometry.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": []},
                    "properties": {"route_id": f"duty-{tr}"},
                }
            )

    async def snapshot(self):
        async with self.lock:
            if self.cache is not None and time.monotonic() - self.cache_at < 1:
                return self.cache
            begin = time.perf_counter()
            cutoff = (
                self.start + (time.monotonic() - self.started) * self.speed
                if self.mode == "replay"
                else time.time()
            )
            # Keep the last state when archive ends. No wrap-around presented as real-time.
            cutoff = (
                min(cutoff, float(self.dataset.traffic.ts.max()))
                if self.mode == "replay"
                else cutoff
            )
            timestamp = iso(cutoff)
            vehicles = []
            items = []
            targets = {}
            features = {}
            geometries = []
            for tr, plan in self.plans.items():
                h = self.dataset.history(tr, cutoff)
                if self.mode == "ndtp":
                    rows = [
                        r
                        for unit, rows in self.receiver.histories.items()
                        if self.unit_map.get(unit) == tr
                        for r in rows
                        if cutoff - 1800 <= r["ts"] <= cutoff
                    ]
                    if not rows:
                        continue
                    h = pd.DataFrame(rows).sort_values("ts")
                gps = h[
                    h.location_valid.eq(True)
                    & h.lat.between(-90, 90)
                    & h.lon.between(-180, 180)
                ]
                if gps.empty or cutoff - gps.iloc[-1].ts > 180:
                    continue
                last = gps.iloc[-1]
                future = plan[(plan.ts > cutoff + 600) & (plan.ts <= cutoff + 900)]
                if future.empty:
                    continue
                target = future.iloc[0].to_dict()
                past = self.actual.get(tr)
                observed = (
                    past[past.actual_ts <= cutoff]
                    if self.mode == "replay" and past is not None
                    else pd.DataFrame()
                )
                cur = (
                    float(observed.iloc[-1].actual_ts - observed.iloc[-1].plan_ts)
                    if len(observed)
                    else 0.0
                )
                if self.mode == "ndtp":
                    # Match a recent low-speed GPS observation to a planned stop, only in a bounded time window.
                    from .features import distance

                    candidates = plan[
                        (plan.ts >= cutoff - 1800) & (plan.ts <= cutoff + 300)
                    ]
                    matches = []
                    for row in h[h.speed.between(0, 3)].tail(30).itertuples():
                        for candidate in candidates.itertuples():
                            if (
                                distance(row.lon, row.lat, candidate.lon, candidate.lat)
                                < 50
                            ):
                                matches.append((row.ts, row.ts - candidate.ts))
                    if matches:
                        latest = max(t for t, _ in matches)
                        cur = float(
                            min((d for t, d in matches if t == latest), key=abs)
                        )
                point = {
                    "tr_id": tr,
                    "T": cutoff,
                    "target_stop_id": target["tt_action_item_id"],
                    "target_time_begin": target["time_begin"],
                    "cur_dev_s": cur,
                }
                feature = self.dataset.feature(point, h)
                vehicle_id = f"vehicle-{tr}"
                targets[vehicle_id] = target
                features[vehicle_id] = feature
                items.append({"vehicleId": vehicle_id, "features": finite(feature)})
                vehicles.append(
                    {
                        "id": vehicle_id,
                        "route_id": f"duty-{tr}",
                        "position": {"lat": float(last.lat), "lon": float(last.lon)},
                        "bearing_deg": float(last.heading)
                        if pd.notna(last.heading)
                        else 0.0,
                        "speed_kmh": float(last.speed)
                        if pd.notna(last.speed) and 0 <= last.speed <= 150
                        else 0.0,
                        "current_delay_sec": cur,
                        "predicted_delay_sec": cur,
                        "risk_probability": 0.0,
                        "risk_level": risk(cur),
                        "status": "active",
                        "next_stop": stop(target),
                        "updated_at": iso(float(last.ts)),
                    }
                )
                # A short observed GPS trace only; never connect stops through buildings.
                trace = (
                    gps[gps.ts >= cutoff - 600][["lon", "lat"]]
                    .iloc[::3]
                    .to_numpy()
                    .tolist()
                )
                geometries.append(
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": trace if len(trace) > 1 else [],
                        },
                        "properties": {"route_id": f"duty-{tr}"},
                    }
                )
            self.status = "no_targets" if not items else "baseline"
            if items:
                try:
                    response = await self.client.post(
                        self.ml_url + "/predict",
                        json={"asOf": timestamp, "items": items},
                    )
                    response.raise_for_status()
                    result = response.json()
                    values = {p["vehicleId"]: p for p in result["predictions"]}
                    if result["asOf"] != timestamp or set(values) != {
                        v["id"] for v in vehicles
                    }:
                        raise ValueError("Incomplete ML response")
                    for vehicle in vehicles:
                        prediction = values[vehicle["id"]]
                        if (
                            not math.isfinite(prediction["delaySec"])
                            or not 0 <= prediction["lateProbability"] <= 1
                        ):
                            raise ValueError("Invalid prediction")
                    for v in vehicles:
                        p = values[v["id"]]
                        v["predicted_delay_sec"] = p["delaySec"]
                        v["risk_probability"] = p["lateProbability"]
                        v["risk_level"] = risk(p["delaySec"])
                    self.status = "connected"
                    self.last_ml_ms = result["latencyMs"]
                    self.last_error = None
                except (httpx.HTTPError, ValueError, KeyError) as error:
                    self.status = "fallback"
                    self.last_error = type(error).__name__
            for v in vehicles:
                v["forecast_horizon_sec"] = features[v["id"]]["horizon_s"]
                v["forecast_target_time"] = iso(targets[v["id"]]["ts"])
                v["forecast_model"] = (
                    self.metrics["modelVersion"]
                    if self.status == "connected"
                    else "persistence-fallback"
                )
            by_route = {v["route_id"]: v for v in vehicles}
            routes = []
            for route in self.catalog:
                v = by_route.get(route["id"])
                if v:
                    routes.append(
                        {
                            **route,
                            "vehicle_count": 1,
                            **{
                                key: v[key]
                                for key in [
                                    "current_delay_sec",
                                    "predicted_delay_sec",
                                    "risk_probability",
                                    "risk_level",
                                ]
                            },
                        }
                    )
            count = len(vehicles)
            delayed = sum(v["current_delay_sec"] > 120 for v in vehicles)
            at_risk = sum(
                v["current_delay_sec"] < -60
                or (
                    -60 <= v["current_delay_sec"] <= 120
                    and (
                        v["predicted_delay_sec"] > 120 or v["predicted_delay_sec"] < -60
                    )
                )
                for v in vehicles
            )
            avg = lambda key: sum(v[key] for v in vehicles) / (count or 1)
            alerts = []
            for v in vehicles:
                if v["predicted_delay_sec"] <= 120 and v["risk_probability"] < 0.5:
                    continue
                target = targets[v["id"]]
                f = features[v["id"]]
                reason = (
                    "длительная стоянка"
                    if f["dwell_s"] > 90
                    else "низкая скорость"
                    if f["speed_mean_120"] < 8
                    else "текущее отклонение от расписания"
                )
                alerts.append(
                    {
                        "id": f"forecast-{v['id']}-{int(target['tt_action_item_id'])}",
                        "type": "delay_risk",
                        "route_id": v["route_id"],
                        "vehicle_id": v["id"],
                        "severity": "critical"
                        if v["risk_level"] == "critical"
                        else "high"
                        if v["risk_level"] == "high"
                        else "warning",
                        "title": f"ТС {v['id'].removeprefix('vehicle-')} · {v['next_stop']['name']}",
                        "description": f"Остановка через {f['horizon_s'] / 60:.1f} мин · план {iso(target['ts'])[11:16]} (часы CSV). Наблюдаемый фактор: {reason}. "
                        + (
                            "CatBoost; вероятность опоздания >120 с."
                            if self.status == "connected"
                            else "ML недоступен: текущая задержка сохранится, вероятность не оценена."
                        ),
                        "risk_probability": v["risk_probability"],
                        "predicted_delay_sec": v["predicted_delay_sec"],
                        "created_at": timestamp,
                    }
                )
            summary = {
                "timestamp": timestamp,
                "vehicles_total": len(self.plans),
                "vehicles_active": count,
                "routes_active": len(routes),
                "on_time_percent": (count - delayed - at_risk) / (count or 1) * 100,
                "at_risk_percent": at_risk / (count or 1) * 100,
                "delayed_percent": delayed / (count or 1) * 100,
                "average_delay_sec": avg("current_delay_sec"),
                "average_predicted_delay_sec": avg("predicted_delay_sec"),
            }
            point = {
                "timestamp": timestamp,
                "actual_delay_sec": avg("current_delay_sec"),
                "predicted_delay_sec": None,
            }
            if self.series and int(
                pd.Timestamp(self.series[-1]["timestamp"]).timestamp() / 30
            ) == int(cutoff / 30):
                self.series[-1] = point
            else:
                self.series.append(point)
            points = list(self.series)
            # Forecast horizon varies per stop; do not draw a fabricated 0–15 min prediction curve.
            self.cache = {
                "routes": routes,
                "vehicles": vehicles,
                "alerts": alerts,
                "segments": [],
                "summary": summary,
                "points": points,
                "geometries": geometries,
            }
            self.cache_at = time.monotonic()
            self.last_ms = round((time.perf_counter() - begin) * 1000, 2)
            return self.cache


@asynccontextmanager
async def lifespan(app):
    engine = Engine()
    app.state.engine = engine
    async with httpx.AsyncClient(timeout=1.5) as client:
        engine.client = client
        tcp = await asyncio.start_server(
            engine.receiver.handle, "127.0.0.1", int(os.getenv("NDTP_PORT", "9201"))
        )
        async with tcp:
            yield


app = FastAPI(
    title="Transit Hub · Telemetry and schedule backend",
    version="1.0",
    lifespan=lifespan,
)


@app.get("/snapshot")
async def snapshot():
    return await app.state.engine.snapshot()


@app.get("/catalog")
def catalog():
    return {"routes": app.state.engine.catalog, "geometries": app.state.engine.geometry}


@app.get("/status")
async def status():
    e = app.state.engine
    await e.snapshot()
    return {
        "mode": "official-" + e.mode,
        "status": e.status,
        "asOf": e.cache["summary"]["timestamp"],
        "modelVersion": e.metrics["modelVersion"]
        if e.status == "connected"
        else "persistence-fallback",
        "metrics": e.metrics,
        "pipelineMs": e.last_ms,
        "inferenceMs": e.last_ml_ms,
        "ndtp": e.receiver.status(),
        "lastError": e.last_error,
        "clockNote": "Время исходного CSV без указанной временной зоны; часы не переводятся в МСК.",
        "predictedVehicles": len(e.cache["vehicles"]),
    }
