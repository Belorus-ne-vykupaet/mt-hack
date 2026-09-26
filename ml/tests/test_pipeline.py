import asyncio
import json
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient
from transit_ml.backend import Engine
from transit_ml.features import FEATURES
from transit_ml.inference import app

ROOT = Path("ml/data/official")


def test_saved_submission_has_exact_official_format():
    submission = pd.read_csv("ml/artifacts/submission.csv", sep=";")
    template = pd.read_csv(ROOT / "sample_submission.csv", sep=";")
    assert list(submission.columns) == ["sample_id", "prediction"]
    assert submission.sample_id.tolist() == template.sample_id.tolist()
    assert (
        not submission.sample_id.duplicated().any()
        and np.isfinite(submission.prediction).all()
    )


def test_model_schema_and_actual_inference():
    with TestClient(app) as client:
        features = dict.fromkeys(FEATURES, None)
        features.update(cur_dev_s=100, horizon_s=720)
        body = {
            "asOf": "2026-01-06T12:00:00Z",
            "items": [{"vehicleId": "test", "features": features}],
        }
        result = client.post("/predict", json=body)
        assert result.status_code == 200
        p = result.json()["predictions"][0]
        assert np.isfinite(p["delaySec"]) and 0 <= p["lateProbability"] <= 1
        features["horizon_s"] = 600
        assert client.post("/predict", json=body).status_code == 422
        features["horizon_s"] = 720
        features["target_delay_s"] = 100
        assert client.post("/predict", json=body).status_code == 422


def test_default_replay_has_ten_real_targets_with_fresh_gps(monkeypatch):
    monkeypatch.delenv("REPLAY_START", raising=False)
    monkeypatch.delenv("REPLAY_SPEED", raising=False)
    engine = Engine()

    def predicted(request):
        body = json.loads(request.content)
        return httpx.Response(200, json={
            "asOf": body["asOf"],
            "latencyMs": 1,
            "predictions": [
                {"vehicleId": item["vehicleId"], "delaySec": 60, "lateProbability": 0.2}
                for item in body["items"]
            ],
        })

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(predicted)) as client:
            engine.client = client
            return await engine.snapshot()

    result = asyncio.run(run())
    forecasted = [v for v in result["vehicles"] if v["forecast_status"] == "ready"]
    assert result["summary"]["timestamp"].startswith("2026-01-06T07:27:")
    assert result["summary"]["vehicles_predicted"] == len(forecasted) == 10
    assert all(v["telemetry_age_sec"] <= 180 for v in forecasted)
    assert all(600 < v["forecast_horizon_sec"] <= 900 for v in forecasted)
    assert all(v["next_stop"] is not None for v in forecasted)


def test_backend_ml_failure_fallback_and_recovery(monkeypatch):
    monkeypatch.setenv("REPLAY_SPEED", "0")

    async def run():
        engine = Engine()

        def failed(request):
            raise httpx.ConnectError("offline", request=request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(failed)) as client:
            engine.client = client
            s = await engine.snapshot()
            assert s["vehicles"] and engine.status == "fallback"
            assert all(
                v["current_delay_sec"] == v["predicted_delay_sec"]
                for v in s["vehicles"] if v["forecast_status"] == "fallback"
            )
            assert all(600 < v["forecast_horizon_sec"] <= 900 for v in s["vehicles"] if v["forecast_horizon_sec"] is not None)

        def recovered(request):
            body = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "asOf": body["asOf"],
                    "modelVersion": "test",
                    "latencyMs": 1,
                    "predictions": [
                        {
                            "vehicleId": i["vehicleId"],
                            "delaySec": 123,
                            "lateProbability": 0.7,
                        }
                        for i in body["items"]
                    ],
                },
            )

        engine.cache_at = 0
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(recovered)
        ) as client:
            engine.client = client
            s = await engine.snapshot()
            ready = [v for v in s["vehicles"] if v["forecast_status"] == "ready"]
            assert engine.status == "connected" and ready
            assert all(v["predicted_delay_sec"] == 123 for v in ready)

    asyncio.run(run())


def test_observed_segments_locate_vehicle_risk_without_inventing_segment_forecasts(monkeypatch):
    monkeypatch.setenv("REPLAY_SPEED", "0")
    engine = Engine()

    def uncertain(request):
        body = json.loads(request.content)
        return httpx.Response(200, json={
            "asOf": body["asOf"], "latencyMs": 1,
            "predictions": [{"vehicleId": item["vehicleId"], "delaySec": 105,
                             "lateProbability": .71} for item in body["items"]],
        })

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(uncertain)) as client:
            engine.client = client
            return await engine.snapshot()

    snapshot = asyncio.run(run())
    segments = {segment["id"]: segment for segment in snapshot["segments"]}
    assert segments and len(segments) == len(snapshot["segments"])
    matched = [v for v in snapshot["vehicles"]
               if v["current_segment_id"] and v["forecast_status"] == "ready"]
    assert matched
    for vehicle in matched:
        segment = segments[vehicle["current_segment_id"]]
        assert segment["risk_level"] == vehicle["risk_level"] == "elevated"
        assert segment["risk_scope"] == "vehicle_target_stop"
        assert segment["forecast_target_stop_id"] == vehicle["next_stop"]["id"]
        assert segment["mean_speed_kmh"] is None or 0 <= segment["mean_speed_kmh"] <= 150
        assert segment["dwell_sec"] is None or 0 <= segment["dwell_sec"] <= segment["coverage_sec"]
        assert vehicle["observed_factor"]
    historical = [s for s in segments.values() if not s["is_current"]]
    assert historical and all(s["predicted_delay_sec"] is None for s in historical)
    assert all(s["geometry_source"] == "observed_gps" and s["started_at"] <= engine.last_cutoff
               for s in segments.values())


def test_live_ndtp_features_to_real_sasha_model(tmp_path, monkeypatch):
    """A current binary navigation frame + matching plan reaches the actual loaded ML model."""
    import struct
    import time
    from collections import deque

    from transit_ml.ndtp import crc16, parse_frame

    now = int(time.time())
    target = pd.Timestamp(now + 720, unit="s", tz="UTC").isoformat()
    pd.DataFrame(
        [
            {
                "tt_action_item_id": 101,
                "tr_id": 1,
                "time_begin": target,
                "geom": "POINT (37.63 55.76)",
                "building_address": "Тестовая остановка",
            }
        ]
    ).to_csv(tmp_path / "schedule_plan.csv", index=False)
    (tmp_path / "unit-map.json").write_text('{"123":1}')
    monkeypatch.setenv("TELEMETRY_MODE", "ndtp")
    monkeypatch.setenv("LIVE_PLAN_DIR", str(tmp_path))
    monkeypatch.setenv("OFFICIAL_DATA_DIR", str(tmp_path / "absent-archive"))
    payload = (
        struct.pack("<HHHI", 1, 101, 1, 1)
        + bytes([0, 0])
        + struct.pack(
            "<IIIBBHHHHHBB",
            now,
            376173210,
            557551234,
            224,
            100,
            30,
            35,
            90,
            100,
            150,
            8,
            1,
        )
    )
    frame = (
        struct.pack("<HHHHBIH", 0x7E7E, len(payload), 0, crc16(payload), 2, 123, 0)
        + payload
    )

    async def run():
        engine = Engine()
        engine.receiver.histories[123] = deque([parse_frame(frame)], maxlen=1500)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://ml"
            ) as client,
        ):
            engine.client = client
            engine.ml_url = "http://ml"
            result = await engine.snapshot()
            assert engine.status == "connected" and len(result["vehicles"]) == 1
            v = result["vehicles"][0]
            assert (
            v["id"] == "vehicle-1" and v["forecast_model"] == "sasha-extra-trees-v2"
            )
            assert 600 < v["forecast_horizon_sec"] <= 900 and np.isfinite(
                v["predicted_delay_sec"]
            )
            assert 0 <= v["risk_probability"] <= 1

    asyncio.run(run())
