"""Python orchestration: official CSV replay / NDTP reception -> causal features -> ML API."""

import asyncio
import hashlib
import json
import math
import os
import time
from collections import deque
from contextlib import asynccontextmanager, suppress
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
from fastapi import FastAPI, Query

from .features import Dataset, distance, seconds
from .ndtp import Receiver
from .segments import SegmentMatcher
from .outcomes import OUTCOME_FIELDS, arrival_outcome, visible_outcome
from .evaluation import ForecastJournal
from .warnings import LATENESS_THRESHOLD_SEC, warning_timing


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


def finite_number(value):
    """Keep missing NDTP fields nullable in JSON instead of emitting NaN."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def stop(row, sequence=0):
    return {
        "id": str(row["tt_action_item_id"]),
        "name": str(row["building_address"])
        if pd.notna(row["building_address"])
        else f"Остановка {int(row['tt_action_item_id'])}",
        "sequence": sequence,
        "position": {"lon": float(row["lon"]), "lat": float(row["lat"])},
    }


def observed_arrival(target, observed_actual, history, cutoff, live=False):
    """Exclude an event already observed at T, never inspect its future outcome."""
    if not live:
        return bool(
            len(observed_actual)
            and observed_actual.tt_action_item_id.eq(target["tt_action_item_id"]).any()
        )
    if history.empty:
        return False
    # Without factual arrivals in NDTP, a bounded stopped GPS match is evidence
    # of arrival. A future or stale packet cannot close the target.
    stopped = history[
        history.speed.between(0, 3)
        & history.ts.between(target["ts"] - 1800, cutoff)
        & history.location_valid.eq(True)
    ]
    return any(
        distance(row.lon, row.lat, target["lon"], target["lat"]) < 50
        for row in stopped.itertuples()
    )


def observed_factor(features, current_delay):
    """Describe only signals observed by T; never claim a causal ML explanation."""
    if features["dwell_s"] > 90:
        return "длительная наблюдаемая стоянка"
    if features["speed_mean_120"] < 8:
        return "низкая наблюдаемая скорость за 2 минуты"
    if current_delay is not None and current_delay > 120:
        return "задержка уже есть на предыдущих остановках"
    return "отклонение и телеметрия до момента прогноза"


def observed_paths(gps, cutoff):
    """Causal GPS trails; split gaps and jumps instead of drawing across streets."""
    if gps.empty:
        return []
    end = np.searchsorted(gps.ts.to_numpy(), cutoff, side="right")
    samples = gps.iloc[:end][["ts", "lon", "lat"]].to_numpy(dtype=float)
    if len(samples) < 2:
        return []
    lon, lat = samples[:, 1], samples[:, 2]
    jump_m = np.hypot(
        np.diff(lon) * np.cos(np.deg2rad((lat[1:] + lat[:-1]) / 2)),
        np.diff(lat),
    ) * 111195
    breaks = np.where((np.diff(samples[:, 0]) > 120) | (jump_m > 250))[0] + 1
    paths = []
    for chunk in np.split(samples[:, 1:3], breaks):
        if len(chunk) < 2:
            continue
        # Stationary packets add no visible geometry.
        moved = np.r_[True, np.any(np.diff(chunk, axis=0) != 0, axis=1)]
        coords = chunk[moved]
        if len(coords) < 2:
            continue
        stride = max(1, math.ceil(len(coords) / 400))
        line = coords[::stride]
        if not np.array_equal(line[-1], coords[-1]):
            line = np.vstack((line, coords[-1]))
        paths.append(line.tolist())
    return paths


class Engine:
    def __init__(self, journal_path=None):
        self.mode = os.getenv("TELEMETRY_MODE", "replay")
        if self.mode not in ("replay", "ndtp"):
            raise ValueError("TELEMETRY_MODE must be replay or ndtp")
        self.root = Path(os.getenv("OFFICIAL_DATA_DIR", "ml/data/official"))
        live_plan = os.getenv("LIVE_PLAN_DIR") if self.mode == "ndtp" else None
        if self.mode == "ndtp" and not live_plan:
            raise ValueError("LIVE_PLAN_DIR is required for NDTP; archived plans are not current")
        self.dataset = (
            Dataset(Path(live_plan), allow_empty_traffic=True)
            if live_plan else Dataset(self.root / "test")
        )
        self.actual = {}
        if self.mode == "replay":
            # Future actual arrivals are kept for retrospective audit only.
            actual = pd.read_csv(self.root / "test/schedule.csv")
            actual["actual_ts"] = seconds(actual.time_fact_begin)
            actual["plan_ts"] = seconds(actual.time_begin)
            self.actual = {
                int(k): v.sort_values("actual_ts").dropna(subset=["actual_ts"])
                for k, v in actual.groupby("tr_id")
            }
        self.plans = {int(k): v for k, v in self.dataset.schedule.groupby("tr_id")}
        self.segment_matchers = {
            tr: SegmentMatcher(plan, route_id=f"duty-{tr}")
            for tr, plan in self.plans.items()
        }
        self.started = time.monotonic()
        self.start = pd.Timestamp(
            os.getenv("REPLAY_START", "2026-01-06 07:27:00"), tz="UTC"
        ).timestamp()
        self.speed = float(os.getenv("REPLAY_SPEED", "0.25"))
        self.packet_event = asyncio.Event()
        self.receiver = Receiver(on_packet=self._on_packet)
        self.unmapped_packets = 0
        self.mapped_packets = 0
        self.coalesced_packets = 0
        self.pipeline_samples_ms = deque(maxlen=256)
        self.cache = None
        self.cache_at = 0.0
        self.lock = asyncio.Lock()
        self.status = "starting"
        self.last_ms = 0.0
        self.last_error = None
        self.metrics = json.loads(
            Path(os.getenv("ML_ARTIFACTS", "ml/artifacts"), "metrics.json").read_text()
        )
        plan_digest = hashlib.sha256(self.dataset.schedule[
            ["tr_id", "tt_action_item_id", "ts", "lon", "lat"]
        ].to_csv(index=False).encode()).hexdigest()[:20]
        self.journal = ForecastJournal(
            f"{self.mode}:{self.metrics['modelVersion']}:{plan_digest}", journal_path,
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
        if live_plan:
            self.unit_map = {
                int(k): int(v)
                for k, v in json.loads((Path(live_plan) / "unit-map.json").read_text()).items()
            }
        self.receiver.allowed_units = set(self.unit_map)
        self.model_plans = {
            tr: [
                {
                    "tt_action_item_id": int(row.tt_action_item_id),
                    "tr_id": tr,
                    "time_begin": str(row.time_begin),
                    "geom": str(row.geom),
                }
                for row in plan.itertuples()
            ]
            for tr, plan in self.plans.items()
        }
        self.catalog = []
        self.geometry = []
        self.series = deque(maxlen=240)
        # First publication is immutable for each vehicle/target/model state.
        # The bounded audit is evidence of when an alert actually appeared.
        self.warning_first_issued = {}
        self.warning_audit = deque(maxlen=5000)
        self.last_cutoff = None
        for tr in sorted(set(self.plans) | set(self.dataset.groups) | set(self.unit_map.values())):
            plan = self.plans.get(tr, self.dataset.schedule.iloc[:0])
            valid = plan[plan.lat.between(-90, 90) & plan.lon.between(-180, 180)]
            stops = [stop(row, i) for i, row in enumerate(valid.to_dict("records"))]
            self.catalog.append(
                {
                    "id": f"duty-{tr}",
                    "number": str(tr),
                    "name": (
                        f"План ТС {tr} · {'текущий план NDTP' if self.mode == 'ndtp' else 'официальный CSV'}"
                        if tr in self.plans else f"ТС {tr} · расписание отсутствует"
                    ),
                    "transport_type": "bus",
                    "stops": stops,
                    "vehicle_count": 0,
                    "current_delay_sec": None,
                    "predicted_delay_sec": None,
                    "risk_probability": None,
                    "risk_level": "unknown",
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

    def _on_packet(self, row):
        if row["unit_id"] in self.unit_map:
            self.mapped_packets += 1
            if self.packet_event.is_set():
                self.coalesced_packets += 1
            self.packet_event.set()
        else:
            self.unmapped_packets += 1

    async def stream_forecasts(self):
        """Coalesce live NDTP frames into at most one forecast per second."""
        while True:
            await self.packet_event.wait()
            self.packet_event.clear()
            remaining = 1 - (time.monotonic() - self.cache_at)
            if remaining > 0:
                await asyncio.sleep(remaining)
            self.cache_at = 0
            try:
                await self.snapshot()
            except Exception as error:
                self.last_error = type(error).__name__

    def observe_warning_outcomes(self, cutoff, segment_matches):
        """Close warnings and model forecasts from past observations, independently of inference."""
        pending = [row for row in self.warning_audit if "outcome_observed_at" not in row]
        keys = {(row["vehicle_id"], row["target_stop_id"]) for row in pending}
        keys.update((row["vehicle_id"], row["target_id"]) for row in self.journal.pending(cutoff))
        arrivals = {}
        if self.mode == "replay":
            target_ids = {}
            for vehicle, target in keys:
                tr = int(vehicle.removeprefix("vehicle-"))
                target_ids.setdefault(tr, set()).add(int(target))
            for tr, ids in target_ids.items():
                actual = self.actual.get(tr)
                if actual is None:
                    continue
                observed = actual[actual.actual_ts.le(cutoff)
                                  & actual.tt_action_item_id.isin(ids)]
                for row in observed.itertuples():
                    arrivals.setdefault((tr, str(int(row.tt_action_item_id))), float(row.actual_ts))
            source = "schedule_actual"
        else:
            source = "ndtp_ordered_stop_visit"
            for vehicle_id, match in segment_matches.items():
                tr = int(vehicle_id.removeprefix("vehicle-"))
                for visit in match.get("stop_visits", []):
                    if visit["observed_at"] <= cutoff:
                        arrivals.setdefault((tr, visit["stop_id"]), visit["observed_at"])
        for row in pending:
            key = (int(row["vehicle_id"].removeprefix("vehicle-")), row["target_stop_id"])
            arrived = arrivals.get(key)
            if arrived is None:
                continue
            outcome = arrival_outcome(
                planned_at=pd.Timestamp(row["target_time"]).timestamp(),
                issued_at=pd.Timestamp(row["issued_at"]).timestamp(),
                arrival_at=arrived, observed_at=cutoff, cutoff=cutoff, source=source,
            )
            if outcome is not None:
                row.update(outcome)
        self.journal.observe({(f"vehicle-{tr}", target): at for (tr, target), at in arrivals.items()}, cutoff, source)

    async def snapshot(self):
        async with self.lock:
            # NDTP packets already wake stream_forecasts. Read-only API polling
            # must not launch a second full-fleet inference every second while
            # the same GPS state is cached. A five-second refresh still marks
            # silent vehicles stale and advances the live clock during outages.
            cache_ttl = 5 if self.mode == "ndtp" else 1
            if self.cache is not None and time.monotonic() - self.cache_at < cache_ttl:
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
            self.last_cutoff = cutoff
            vehicles = []
            items = []
            targets = {}
            features = {}
            segment_matches = {}
            geometries = []
            live_histories = {}
            if self.mode == "ndtp":
                # Index packets once per snapshot. Scanning every unit history for
                # every route becomes expensive as the live fleet grows.
                for unit, history in self.receiver.histories.items():
                    tr = self.unit_map.get(unit)
                    if tr is None:
                        continue
                    rows = [row for row in history if row["ts"] <= cutoff]
                    if rows:
                        live_histories.setdefault(tr, []).extend(rows)
            for route in self.catalog:
                tr = int(route["number"])
                plan = self.plans.get(tr, self.dataset.schedule.iloc[:0])
                if self.mode == "ndtp":
                    rows = live_histories.get(tr)
                    if not rows:
                        continue
                    h = pd.DataFrame(rows).sort_values("ts")
                else:
                    h = self.dataset.history(tr, cutoff)
                gps = h[
                    h.location_valid.eq(True)
                    & h.lat.between(-90, 90)
                    & h.lon.between(-180, 180)
                ]
                last = (
                    self.dataset.last_position(tr, cutoff)
                    if self.mode == "replay"
                    else gps.iloc[-1] if not gps.empty else None
                )
                if last is None:
                    continue  # Never invent a position or use a future observation.
                age = max(0.0, cutoff - float(last.ts))
                fresh = age <= 180
                past = self.actual.get(tr)
                observed = (
                    past[past.actual_ts <= cutoff]
                    if self.mode == "replay" and past is not None
                    else pd.DataFrame()
                )
                matcher = self.segment_matchers.get(tr)
                matched = matcher.match(h, cutoff) if matcher is not None else {
                    "status": "unavailable", "reason": "no_schedule",
                    "current_segment_id": None, "current_delay_sec": None,
                    "segments": [], "observed_stop_ids": [],
                }
                reached_stops = set(matched["observed_stop_ids"])
                future = plan[(plan.ts > cutoff + 600) & (plan.ts <= cutoff + 900)]
                target = next(
                    (
                        candidate
                        for candidate in future.to_dict("records")
                        if not (
                            str(int(candidate["tt_action_item_id"])) in reached_stops
                            if self.mode == "ndtp" and len(plan) > 1 else
                            observed_arrival(candidate, observed, h, cutoff, self.mode == "ndtp")
                        )
                    ),
                    None,
                )
                forecast_status = (
                    "stale_gps" if not fresh else
                    "no_schedule" if plan.empty else
                    "no_target" if target is None else "pending"
                )
                cur = (
                    float(observed.iloc[-1].actual_ts - observed.iloc[-1].plan_ts)
                    if len(observed)
                    else None
                )
                if not fresh:
                    cur = None
                if self.mode == "ndtp" and fresh:
                    # An ordered observed visit anchors deviation. Repeated
                    # stationary packets must not become a later arrival.
                    cur = matched["current_delay_sec"]
                vehicle_id = f"vehicle-{tr}"
                segment_matches[vehicle_id] = matched
                if forecast_status == "pending":
                    # The model uses only the last 30 minutes; avoid uploading
                    # older map-trail packets on every packet-triggered forecast.
                    model_history = h[h.ts >= cutoff - 1800]
                    point = {
                        "tr_id": tr, "T": cutoff,
                        "target_stop_id": target["tt_action_item_id"],
                        "target_time_begin": target["time_begin"],
                        "cur_dev_s": cur if cur is not None else float("nan"),
                    }
                    feature = self.dataset.feature(point, model_history)
                    targets[vehicle_id] = target
                    features[vehicle_id] = feature
                    items.append({
                        "vehicleId": vehicle_id,
                        "features": finite(feature),
                        "point": {
                            "sample_id": vehicle_id,
                            "tr_id": tr,
                            "T": timestamp,
                            "target_stop_id": int(target["tt_action_item_id"]),
                            "target_time_begin": str(target["time_begin"]),
                            "cur_dev_s": finite_number(cur),
                        },
                        "telemetry": [
                            {
                                "tr_id": tr,
                                "event_time": iso(float(row.ts)),
                                "location_valid": bool(row.location_valid),
                                "lon": finite_number(row.lon),
                                "lat": finite_number(row.lat),
                                "speed": finite_number(row.speed),
                                "heading": finite_number(row.heading),
                            }
                            for row in model_history.itertuples()
                        ],
                        "schedule": self.model_plans[tr],
                    })
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
                        "doors_open": bool(last.get("doors_open"))
                        if pd.notna(last.get("doors_open")) else None,
                        "current_delay_sec": cur,
                        "predicted_delay_sec": None,
                        "risk_probability": None,
                        "risk_level": "unknown",
                        "status": "active" if fresh else "stale",
                        "telemetry_age_sec": round(age, 1),
                        "forecast_status": forecast_status,
                        "forecast_horizon_sec": None,
                        "forecast_target_time": None,
                        "forecast_model": None,
                        "observed_factor": None,
                        "current_segment_id": matched["current_segment_id"],
                        "segment_match_status": "matched" if matched["status"] == "matched" else "unavailable",
                        "segment_match_reason": matched["reason"],
                        "next_stop": stop(target) if target is not None and fresh else None,
                        "updated_at": iso(float(last.ts)),
                    }
                )
                # Map geometry may use past observations beyond the 30-minute ML
                # feature window; the model still receives only causal features.
                observed = (
                    self.dataset.gps_groups.get(tr)
                    if self.mode == "replay"
                    else gps
                )
                paths = observed_paths(observed, cutoff)
                geometries.append(
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": max(paths, key=len) if paths else [],
                        },
                        "properties": {
                            "route_id": f"duty-{tr}",
                            "observed_paths": paths,
                        },
                    }
                )
            self.status = "no_targets" if not items else "baseline"
            if items:
                try:
                    response = await self.client.post(
                        self.ml_url + "/predict/raw",
                        json={"asOf": timestamp, "items": items},
                    )
                    response.raise_for_status()
                    result = response.json()
                    values = {p["vehicleId"]: p for p in result["predictions"]}
                    if result["asOf"] != timestamp or set(values) != {
                        i["vehicleId"] for i in items
                    }:
                        raise ValueError("Incomplete ML response")
                    for vehicle in vehicles:
                        if vehicle["id"] not in features:
                            continue
                        prediction = values[vehicle["id"]]
                        if (
                            not math.isfinite(prediction["delaySec"])
                            or not 0 <= prediction["lateProbability"] <= 1
                        ):
                            raise ValueError("Invalid prediction")
                    for v in vehicles:
                        if v["id"] not in features:
                            continue
                        v["forecast_status"] = "ready"
                        p = values[v["id"]]
                        v["predicted_delay_sec"] = p["delaySec"]
                        v["risk_probability"] = p["lateProbability"]
                        v["risk_level"] = risk(p["delaySec"])
                        # The classifier can warn about >120 s lateness even when
                        # the regression point estimate is below that threshold.
                        # Keep the route badge and attention list consistent with
                        # the alert, without treating uncalibrated probability as
                        # evidence for a high/critical severity.
                        if p["lateProbability"] >= 0.5 and v["risk_level"] == "normal":
                            v["risk_level"] = "elevated"
                    self.status = "connected"
                    self.last_ml_ms = result["latencyMs"]
                    self.last_error = None
                except (httpx.HTTPError, ValueError, KeyError) as error:
                    self.status = "fallback"
                    self.last_error = type(error).__name__
            for v in vehicles:
                if v["id"] not in features:
                    continue
                if self.status != "connected":
                    v["forecast_status"] = "fallback" if v["current_delay_sec"] is not None else "unavailable"
                    v["predicted_delay_sec"] = v["current_delay_sec"]
                    v["risk_level"] = risk(v["current_delay_sec"]) if v["current_delay_sec"] is not None else "unknown"
                v["forecast_horizon_sec"] = features[v["id"]]["horizon_s"]
                v["forecast_target_time"] = iso(targets[v["id"]]["ts"])
                v["forecast_model"] = (
                    self.metrics["modelVersion"]
                    if self.status == "connected"
                    else "persistence-fallback"
                )
                v["observed_factor"] = observed_factor(
                    features[v["id"]], v["current_delay_sec"]
                )
            self.journal.issue([
                {"vehicle_id": v["id"], "target_id": v["next_stop"]["id"],
                 "stop_name": v["next_stop"]["name"], "issued_at": cutoff,
                 "planned_at": float(targets[v["id"]]["ts"]),
                 "predicted": v["predicted_delay_sec"], "model": v["forecast_model"]}
                for v in vehicles if v["forecast_status"] == "ready"
            ])
            segments = []
            for v in vehicles:
                match = segment_matches[v["id"]]
                for observed_segment in match["segments"]:
                    segment = {
                        **observed_segment,
                        "predicted_delay_sec": None,
                        "risk_probability": None,
                        "risk_level": risk(observed_segment["current_delay_sec"])
                        if observed_segment["current_delay_sec"] is not None else "unknown",
                    }
                    if observed_segment["id"] == v["current_segment_id"]:
                        # Locate the vehicle's stop-arrival forecast on its
                        # currently observed segment. This is not a separate
                        # model predicting road congestion on that segment.
                        segment.update({
                            "predicted_delay_sec": v["predicted_delay_sec"],
                            "risk_probability": v["risk_probability"],
                            "risk_level": v["risk_level"],
                            "risk_scope": "vehicle_target_stop",
                        })
                        if v["next_stop"] is not None:
                            segment["forecast_target_stop_id"] = v["next_stop"]["id"]
                    segments.append(segment)
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
                                    "forecast_status",
                                ]
                            },
                        }
                    )
            fresh_vehicles = [v for v in vehicles if v["status"] == "active"]
            predicted = [v for v in vehicles if v["predicted_delay_sec"] is not None]
            assessed = [v for v in predicted if v["current_delay_sec"] is not None]
            count = len(assessed)
            delayed = sum(v["current_delay_sec"] > 120 for v in assessed)
            at_risk = sum(
                v["current_delay_sec"] < -60
                or (-60 <= v["current_delay_sec"] <= 120 and
                    v["risk_level"] not in ("normal", "unknown"))
                for v in assessed
            )
            def avg(key):
                values = [v[key] for v in fresh_vehicles if v[key] is not None]
                return sum(values) / len(values) if values else 0
            alerts = []
            for v in vehicles:
                if v["predicted_delay_sec"] is None:
                    continue
                if v["predicted_delay_sec"] <= 120 and (v["risk_probability"] or 0) < 0.5:
                    continue
                target = targets[v["id"]]
                f = features[v["id"]]
                reason = observed_factor(f, v["current_delay_sec"])
                alert_id = f"forecast-{v['id']}-{int(target['tt_action_item_id'])}"
                first_issue = self.warning_first_issued.get(alert_id)
                timing = warning_timing(float(target["ts"]), cutoff, first_issue)
                if timing is None:
                    # Vehicle forecasts/risk remain available across the full
                    # ML window. Publish a first warning only inside the
                    # declared event window, never by moving its issue time.
                    continue
                if first_issue is None:
                    first_issue = cutoff
                    self.warning_first_issued[alert_id] = first_issue
                    if len(self.warning_first_issued) > 5000:
                        self.warning_first_issued.pop(next(iter(self.warning_first_issued)))
                    self.warning_audit.append({
                        **timing,
                        "id": alert_id,
                        "vehicle_id": v["id"],
                        "target_stop_id": str(target["tt_action_item_id"]),
                        "issued_at": iso(first_issue),
                        "target_time": iso(target["ts"]),
                        "lead_time_sec": round(target["ts"] - first_issue, 1),
                        "model_status": v["forecast_status"],
                        "source": self.mode,
                        "current_delay_sec_at_issue": v["current_delay_sec"],
                        "predicted_delay_sec_at_issue": v["predicted_delay_sec"],
                        "risk_probability_at_issue": v["risk_probability"],
                        "telemetry_age_sec_at_issue": v["telemetry_age_sec"],
                        "observed_factor_at_issue": reason,
                    })
                lead_time = target["ts"] - cutoff
                assert 600 < lead_time <= 900
                eta = target["ts"] + v["predicted_delay_sec"]
                alerts.append(
                    {
                        **timing,
                        "id": alert_id,
                        "type": "delay_risk",
                        "route_id": v["route_id"],
                        "vehicle_id": v["id"],
                        "severity": "critical"
                        if v["risk_level"] == "critical"
                        else "high"
                        if v["risk_level"] == "high"
                        else "warning",
                        "title": f"ТС {v['id'].removeprefix('vehicle-')} · {v['next_stop']['name']}",
                        "description": f"Остановка через {lead_time / 60:.1f} мин · план {iso(target['ts'])[11:16]}, ожидается {iso(eta)[11:16]} ({'часы текущего плана' if self.mode == 'ndtp' else 'часы CSV'}). Наблюдаемый фактор: {reason}. "
                        + (
                            "ExtraTrees; вероятность опоздания >120 с по отдельному классификатору."
                            if self.status == "connected"
                            else "ML недоступен: текущая задержка сохранится, вероятность не оценена."
                        ),
                        "risk_probability": v["risk_probability"] or 0,
                        "predicted_delay_sec": v["predicted_delay_sec"],
                        "created_at": iso(first_issue),
                        "target_time": iso(target["ts"]),
                        "expected_arrival_at": iso(eta),
                        "lead_time_sec": round(target["ts"] - first_issue, 1),
                        "observed_factor": reason,
                        "model_status": v["forecast_status"],
                    }
                )
            # Keep observing issued warnings after their ML target leaves the
            # prediction window. Missing GPS is unknown, never a confirmed delay.
            self.observe_warning_outcomes(cutoff, segment_matches)
            summary = {
                "timestamp": timestamp,
                "vehicles_total": len(self.catalog),
                "vehicles_active": len(fresh_vehicles),
                "vehicles_located": len(vehicles),
                "vehicles_stale": len(vehicles) - len(fresh_vehicles),
                "vehicles_predicted": len(predicted),
                "vehicles_assessed": count,
                "vehicles_without_position": len(self.catalog) - len(vehicles),
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
                "segments": segments,
                "summary": summary,
                "points": points,
                "geometries": geometries,
            }
            self.cache_at = time.monotonic()
            self.last_ms = round((time.perf_counter() - begin) * 1000, 2)
            self.pipeline_samples_ms.append(self.last_ms)
            return self.cache


@asynccontextmanager
async def lifespan(app):
    engine = Engine(journal_path=os.getenv("PREDICTION_JOURNAL", "ml/data/predictions.sqlite3"))
    app.state.engine = engine
    async with httpx.AsyncClient(timeout=1.5) as client:
        engine.client = client
        pump = asyncio.create_task(engine.stream_forecasts()) if engine.mode == "ndtp" else None
        tcp = await asyncio.start_server(
            engine.receiver.handle,
            os.getenv("NDTP_HOST", "127.0.0.1"),
            int(os.getenv("NDTP_PORT", "9201")),
        )
        try:
            async with tcp:
                yield
        finally:
            if pump is not None:
                pump.cancel()
                with suppress(asyncio.CancelledError):
                    await pump
            engine.journal.close()


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
    vehicles = e.cache["vehicles"]
    located_scheduled = {
        int(v["id"].removeprefix("vehicle-"))
        for v in vehicles
        if int(v["id"].removeprefix("vehicle-")) in e.plans
    }
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
        "ndtp": {
            **e.receiver.status(),
            "mappedPackets": e.mapped_packets,
            "unmappedPackets": e.unmapped_packets,
            "coalescedPackets": e.coalesced_packets,
            "forecastPending": e.packet_event.is_set(),
        },
        "pipelineLatencyMs": {
            "samples": len(e.pipeline_samples_ms),
            "p50": round(float(np.percentile(e.pipeline_samples_ms, 50)), 2)
            if e.pipeline_samples_ms else None,
            "p95": round(float(np.percentile(e.pipeline_samples_ms, 95)), 2)
            if e.pipeline_samples_ms else None,
            "p99": round(float(np.percentile(e.pipeline_samples_ms, 99)), 2)
            if e.pipeline_samples_ms else None,
        },
        "lastError": e.last_error,
        "clockNote": (
            "Время NDTP и текущего плана сравнивается в UTC; требуется согласованная временная шкала."
            if e.mode == "ndtp" else
            "Время исходного CSV без указанной временной зоны; часы не переводятся в МСК."
        ),
        "predictedVehicles": e.cache["summary"]["vehicles_predicted"],
        "locatedVehicles": e.cache["summary"]["vehicles_located"],
        "freshVehicles": e.cache["summary"]["vehicles_active"],
        "staleVehicles": e.cache["summary"]["vehicles_stale"],
        "totalVehicles": e.cache["summary"]["vehicles_total"],
        "scheduledVehicles": len(e.plans),
        "contextVehicles": len(e.catalog) - len(e.plans),
        "scheduledWithoutPosition": len(e.plans) - len(located_scheduled),
        "scheduledStale": sum(
            v["forecast_status"] == "stale_gps"
            for v in vehicles
            if int(v["id"].removeprefix("vehicle-")) in e.plans
        ),
        "scheduledWithoutTarget": sum(
            v["forecast_status"] == "no_target" for v in vehicles
        ),
        "warningsIssued": len(e.warning_audit),
        "warningEvent": {
            "type": "late_threshold",
            "latenessThresholdSec": LATENESS_THRESHOLD_SEC,
            "definition": "Potential lateness threshold breach at planned arrival + 120 seconds",
            "firstPublicationLeadSec": {"minExclusive": 600, "maxInclusive": 900},
            "actualArrivalKnownAtPublication": False,
        },
    }


@app.get("/warnings/audit")
async def warning_audit():
    """Immutable first publication plus causally observed arrival/outcome evidence."""
    e = app.state.engine
    await e.snapshot()
    items = []
    for entry in e.warning_audit:
        if pd.Timestamp(entry["issued_at"]).timestamp() > e.last_cutoff:
            continue
        result = {key: value for key, value in entry.items()
                  if not key.startswith("outcome_") and key not in OUTCOME_FIELDS}
        result.update(visible_outcome(entry, e.last_cutoff))
        items.append(result)
    return {"asOf": iso(e.last_cutoff), "items": items}


@app.get("/analytics/forecast-evaluation")
async def forecast_evaluation(route_id: list[str] = Query(default=[]), limit: int = Query(default=200, ge=1, le=500)):
    """First model forecasts paired with observed arrivals; unknown outcomes are never zero."""
    e = app.state.engine
    await e.snapshot()
    return e.journal.report(e.last_cutoff, route_id, limit)
