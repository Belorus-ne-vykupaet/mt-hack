"""Criterion 5 — performance and reliability (0–4), in-process measurements.

Container-level checks (cold start, stopping services, the organizers'
emulator) run in CI by scripts/criteria/docker-audit.mjs.
"""

import asyncio
import json
import os
import sys
import time
from collections import deque
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import pytest

from criteria_helpers import (
    STOP_LAT,
    STOP_LON,
    in_process_ml,
    ml_process,
    percentiles,
    record,
    tcp_server,
    write_live_plan,
)

LIMIT_MS = 2000  # PDF: "ориентир < 1–2 c на поток ТС"
# The official test stream never has more than 10 simultaneous forecasts
# (13 scheduled vehicles, 30 devices); larger fleets measure headroom.
OFFICIAL_SCALE = 10


def _raw_batch(n, t=None):
    from transit_ml.features import FEATURES

    t = t or pd.Timestamp("2026-09-26 12:00:00")
    stamp = lambda ts: ts.strftime("%Y-%m-%d %H:%M:%S")
    target = t + pd.Timedelta(seconds=720)
    items = []
    for i in range(n):
        features = dict.fromkeys(FEATURES, None)
        features.update(cur_dev_s=60.0 + i, horizon_s=720.0)
        items.append({
            "vehicleId": f"v{i}",
            "point": {"sample_id": f"v{i}", "tr_id": 1000 + i, "T": stamp(t), "target_stop_id": 7 + i,
                      "target_time_begin": stamp(target), "cur_dev_s": 60.0 + i},
            "telemetry": [
                {"tr_id": 1000 + i, "event_time": stamp(t - pd.Timedelta(seconds=15 * k)),
                 "location_valid": True, "lon": STOP_LON + 0.001 * i, "lat": STOP_LAT + 0.0003 * k,
                 "speed": float(10 + k % 20), "heading": 0.0}
                for k in range(120, -1, -1)  # 30 minutes of history at 15 s
            ],
            "schedule": [{"tt_action_item_id": 7 + i, "tr_id": 1000 + i, "time_begin": stamp(target),
                          "geom": f"POINT ({STOP_LON + 0.001 * i} {STOP_LAT + 0.04})"}],
            "features": features,
        })
    return {"asOf": stamp(t), "items": items}


@pytest.fixture(scope="module")
def ml_latency():
    from fastapi.testclient import TestClient
    from transit_ml.inference import app

    results = {}
    with TestClient(app) as client:
        client.post("/predict/raw", json=_raw_batch(1))  # warm-up
        for n in (1, OFFICIAL_SCALE, 50, 200):
            body = _raw_batch(n)
            times = []
            for _ in range(5 if n == 200 else 10):
                started = time.perf_counter()
                response = client.post("/predict/raw", json=body)
                times.append((time.perf_counter() - started) * 1000)
                assert response.status_code == 200 and len(response.json()["predictions"]) == n
            results[n] = percentiles(times)
    record("k5.ml_http_latency_ms_by_vehicles", {str(k): v for k, v in results.items()})
    return results


def test_k5_1_ml_inference_latency_at_official_scale(ml_latency):
    assert ml_latency[OFFICIAL_SCALE]["p95"] < LIMIT_MS, ml_latency


@pytest.mark.xfail(strict=False, reason="scalability: inference grows ~linearly per vehicle")
def test_k5_1_ml_inference_latency_for_50_vehicles(ml_latency):
    assert ml_latency[50]["p95"] < LIMIT_MS, ml_latency


def _fleet_engine(tmp_path, monkeypatch, n):
    # Whole seconds, like NDTP timestamps, so live frames are never older than the history.
    now = int(time.time()) - 1
    units = [(20000 + i, 2000 + i) for i in range(n)]
    positions = write_live_plan(tmp_path, units, now, previous_offset=-300, target_offsets=(720,))
    monkeypatch.setenv("TELEMETRY_MODE", "ndtp")
    monkeypatch.setenv("LIVE_PLAN_DIR", str(tmp_path))
    from transit_ml.backend import Engine

    engine = Engine()
    for unit, _ in units:
        lon, lat = positions[unit]
        engine.receiver.histories[unit] = deque(
            ({"unit_id": unit, "ts": now - 15 * k, "lon": lon, "lat": lat, "location_valid": True,
              "speed": 0 if k < 4 else 20, "heading": 0, "alt": 1} for k in range(40, -1, -1)),
            maxlen=1500,
        )
    engine.positions = positions
    return engine


def _pipeline(tmp_path, monkeypatch, n):
    engine = _fleet_engine(tmp_path, monkeypatch, n)

    async def run():
        times, ml = [], []
        async with in_process_ml() as (client, _):
            engine.client, engine.ml_url = client, "http://ml"
            for _ in range(4):
                engine.cache_at = 0
                snapshot = await engine.snapshot()
                times.append(engine.last_ms)
                ml.append(engine.last_ml_ms)
        return snapshot, times, ml

    snapshot, times, ml = asyncio.run(run())
    predicted = sum(v["forecast_status"] == "ready" for v in snapshot["vehicles"])
    record(f"k5.pipeline_ms_{n}_vehicles", {"pipeline": percentiles(times[1:]),
                                             "ml_inference": percentiles(ml[1:]), "predicted": predicted})
    assert predicted == n
    return max(times[1:])


def test_k5_2_backend_full_pipeline_at_official_scale(tmp_path, monkeypatch):
    assert _pipeline(tmp_path, monkeypatch, OFFICIAL_SCALE) < LIMIT_MS


@pytest.mark.xfail(strict=False, reason="scalability: ~80 ms of backend+ML work per vehicle")
@pytest.mark.parametrize("n", [50, 100])
def test_k5_2_backend_full_pipeline_for_larger_fleets(tmp_path, monkeypatch, n):
    assert _pipeline(tmp_path, monkeypatch, n) < LIMIT_MS


def _stream_load(tmp_path, monkeypatch, n, seconds):
    """Devices at 1 Hz from another process; ML in its own process with the production 1.5 s timeout."""
    engine = _fleet_engine(tmp_path, monkeypatch, n)
    handled, runs, loop_lag = [], [], []
    on_packet = engine._on_packet

    def hooked(row):
        handled.append((row["unit_id"], row["alt"], time.time()))
        on_packet(row)

    engine.receiver.on_packet = hooked
    snapshot = engine.snapshot

    async def timed_snapshot():
        result = await snapshot()
        runs.append((engine.last_ms, engine.status, time.time()))
        return result

    engine.snapshot = timed_snapshot
    units_file, log_file = tmp_path / "units.json", tmp_path / "sent.jsonl"
    units_file.write_text(json.dumps(
        [[u, *engine.positions[u]] for u in sorted(engine.receiver.histories)]
    ))

    async def watchdog(stop):
        while not stop.is_set():
            started = time.perf_counter()
            await asyncio.sleep(0.05)
            loop_lag.append((time.perf_counter() - started - 0.05) * 1000)

    async def run(ml_url):
        async with httpx.AsyncClient(timeout=1.5) as client:  # same timeout as backend.lifespan
            engine.client, engine.ml_url = client, ml_url
            pump = asyncio.create_task(engine.stream_forecasts())
            stop = asyncio.Event()
            try:
                async with tcp_server(engine.receiver.handle) as port:
                    guard = asyncio.create_task(watchdog(stop))
                    sender = await asyncio.create_subprocess_exec(
                        sys.executable, str(Path(__file__).with_name("ndtp_load.py")),
                        str(port), str(seconds), str(units_file), str(log_file))
                    await sender.wait()
                    await asyncio.sleep(3)
                    stop.set()
                    await guard
            finally:
                pump.cancel()

    with ml_process() as url:
        asyncio.run(run(url))
    sent = {}
    for line in log_file.read_text().splitlines():
        unit, seq, at = json.loads(line)
        sent[(unit, seq)] = at
    delays = [(at - sent[(u, s)]) * 1000 for u, s, at in handled if (u, s) in sent]
    gaps = np.diff([at for _, _, at in runs]) if len(runs) > 1 else []
    result = {
        "devices": n, "seconds": seconds,
        "frames_sent": len(sent), "frames_accepted": engine.receiver.frames,
        "decode_errors": engine.receiver.errors,
        "ingest_delay_ms": percentiles(delays),
        "event_loop_lag_ms": percentiles(loop_lag),
        "forecast_runs": len(runs),
        "forecast_interval_s": percentiles(gaps),
        "pipeline_ms": percentiles([r[0] for r in runs]),
        "runs_in_ml_fallback": sum(r[1] == "fallback" for r in runs),
    }
    record(f"k5.ndtp_stream_{n}_devices", result)
    return result


def _assert_keeps_up(result):
    assert result["decode_errors"] == 0
    assert result["frames_accepted"] == result["frames_sent"], "frames were lost"
    assert result["ingest_delay_ms"]["p95"] < LIMIT_MS, "ingestion falls behind the stream"
    assert result["runs_in_ml_fallback"] == 0, "ML exceeded the backend's 1.5 s timeout"
    assert result["pipeline_ms"]["p95"] < LIMIT_MS, "a forecast for the stream takes longer than 2 s"


def test_k5_3_stream_at_official_scale_keeps_up(tmp_path, monkeypatch):
    seconds = int(os.getenv("CRITERIA_LOAD_SECONDS", "30"))
    _assert_keeps_up(_stream_load(tmp_path, monkeypatch, OFFICIAL_SCALE, seconds))


@pytest.mark.xfail(strict=False, reason="scalability: per-device forecasts slow down beyond ~20 vehicles")
@pytest.mark.parametrize("n", [30, 100])
def test_k5_3_stream_for_larger_fleets_keeps_up(tmp_path, monkeypatch, n):
    seconds = int(os.getenv("CRITERIA_LOAD_SECONDS", "30"))
    _assert_keeps_up(_stream_load(tmp_path, monkeypatch, n, seconds))


def test_k5_4_ml_outage_degrades_to_fallback_and_recovers(tmp_path, monkeypatch):
    engine = _fleet_engine(tmp_path, monkeypatch, 3)

    def offline(request):
        raise httpx.ConnectError("ml down", request=request)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(offline)) as client:
            engine.client = client
            down = await engine.snapshot()
        async with in_process_ml() as (client, _):
            engine.client, engine.ml_url, engine.cache_at = client, "http://ml", 0
            up = await engine.snapshot()
        return down, up

    down, up = asyncio.run(run())
    assert {v["forecast_model"] for v in down["vehicles"]} == {"persistence-fallback"}
    assert all(v["risk_probability"] is None for v in down["vehicles"])
    assert all(a["model_status"] == "fallback" for a in down["alerts"])
    assert len(down["vehicles"]) == 3, "positions must survive the outage"
    assert {v["forecast_status"] for v in up["vehicles"]} == {"ready"}


def test_k5_4_gps_silence_keeps_the_last_position_marks_it_stale_and_recovers(tmp_path, monkeypatch):
    engine = _fleet_engine(tmp_path, monkeypatch, 1)
    history = next(iter(engine.receiver.histories.values()))
    for row in history:
        row["ts"] -= 200  # the emulator went silent 200 s ago
    last = history[-1]

    async def run():
        async with in_process_ml() as (client, _):
            engine.client, engine.ml_url = client, "http://ml"
            engine.cache_at = 0
            silent = await engine.snapshot()
            history.append({**last, "ts": time.time()})
            engine.cache_at = 0
            back = await engine.snapshot()
        return silent, back

    silent, back = asyncio.run(run())
    stale = silent["vehicles"][0]
    assert stale["status"] == "stale" and stale["forecast_status"] == "stale_gps"
    assert stale["predicted_delay_sec"] is None and stale["position"]["lat"] == pytest.approx(last["lat"])
    assert not silent["alerts"]
    assert back["vehicles"][0]["status"] == "active"
