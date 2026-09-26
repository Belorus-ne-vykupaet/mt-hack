"""Criterion 3 — working system of three modules + Docker (0–6).

Static and in-process checks. The containers themselves are started from the
jury instructions in CI (scripts/criteria/docker-audit.mjs).
"""

import ast
import asyncio
import random
import struct
import time
from collections import deque
from pathlib import Path

import pandas as pd
import pytest
import yaml

from criteria_helpers import (
    DATA,
    ROOT,
    STOP_LAT,
    STOP_LON,
    crc16_modbus,
    handshake_frame,
    nav_cell,
    nav_frame,
    needs_data,
    record,
    tcp_server,
    write_live_plan,
)

COMPOSE_TEXT = (ROOT / "compose.official.yaml").read_text(encoding="utf-8")
COMPOSE = yaml.safe_load(COMPOSE_TEXT)


# --- 3.1 Docker packaging

def test_k3_1_compose_has_four_services_healthchecks_and_start_order():
    services = COMPOSE["services"]
    assert set(services) == {"frontend", "api", "backend", "ml"}
    for name in ("api", "backend", "ml"):
        assert services[name].get("healthcheck", {}).get("test"), f"{name} has no healthcheck"
    assert services["frontend"]["depends_on"]["api"]["condition"] == "service_healthy"
    assert services["api"]["depends_on"]["backend"]["condition"] == "service_healthy"
    assert services["backend"]["depends_on"]["ml"]["condition"] == "service_healthy"
    assert services["backend"]["environment"]["ML_URL"] == "http://ml:8092"
    assert services["api"]["environment"]["OFFICIAL_BACKEND_URL"] == "http://backend:8093"
    assert "${API_TOKEN:?" in COMPOSE_TEXT, "the API token must come from the environment"


def test_k3_1_published_ports_are_loopback_only():
    exposed = [
        (name, port)
        for name, service in COMPOSE["services"].items()
        for port in service.get("ports", [])
        if not str(port).startswith("127.0.0.1:")
    ]
    assert not exposed


def test_k3_1_images_have_distinct_entrypoints_and_python_3_12():
    commands = {name: s.get("command") for name, s in COMPOSE["services"].items()}
    assert commands["backend"][:2] == ["uvicorn", "transit_ml.backend:app"]
    assert commands["ml"][:2] == ["uvicorn", "transit_ml.inference:app"]
    assert (ROOT / "Dockerfile.python").read_text().startswith("FROM python:3.12")
    api = (ROOT / "Dockerfile.api").read_text()
    assert "USER node" in api and "server/index.ts" in api
    front = (ROOT / "Dockerfile").read_text()
    assert "FROM nginx" in front and "pnpm build" in front
    runtime = (ROOT / "ml/requirements-runtime.txt").read_text()
    record("k3.stack", {
        "python_image": "python:3.12-slim",
        "runtime_ml_libraries": [line.split("==")[0] for line in runtime.split() if "==" in line],
        "pytorch_in_runtime_image": "torch" in runtime,
    })


# --- 3.3 Not a monolith

def _imports(path):
    tree = ast.parse(Path(path).read_text(encoding="utf-8"))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(("." if node.level else "") + node.module.split(".")[0])
    return names


def test_k3_3_backend_does_not_load_models_and_talks_to_ml_over_http():
    backend = _imports(ROOT / "ml/transit_ml/backend.py")
    assert not backend & {"catboost", "sklearn", "torch", "joblib", "mt_hack"}
    assert "httpx" in backend
    code = (ROOT / "ml/transit_ml/backend.py").read_text(encoding="utf-8")
    assert 'self.ml_url + "/predict/raw"' in code
    inference = _imports(ROOT / "ml/transit_ml/inference.py")
    assert not inference & {".backend", ".ndtp"}


# --- 3.5 NDTP parsing

from transit_ml.ndtp import Receiver, crc16, parse_frame  # noqa: E402


def test_k3_5_crc_is_modbus_with_the_specified_byte_swap():
    assert crc16_modbus(b"123456789") == 0x4B37  # published CRC-16/MODBUS check value
    assert crc16(b"123456789") == 0x374B


def test_k3_5_navigation_frame_round_trip():
    now = int(time.time())
    row = parse_frame(nav_frame(77, now, 37.6173101, 55.7551201, speed=23, heading=181))
    assert row["unit_id"] == 77 and row["ts"] == now
    assert row["lon"] == pytest.approx(37.6173101, abs=1e-7)
    assert row["lat"] == pytest.approx(55.7551201, abs=1e-7)
    assert (row["speed"], row["heading"], row["location_valid"]) == (23, 181, True)


def test_k3_5_hemisphere_signs_and_invalid_fix():
    row = parse_frame(nav_frame(1, 1, -70.5, -33.4, valid=False))
    assert row["lon"] < 0 and row["lat"] < 0 and not row["location_valid"]


def test_k3_5_handshake_is_accepted():
    assert parse_frame(handshake_frame(9)) == {"unit_id": 9, "handshake": True}


def _with_body(frame, body):
    from criteria_helpers import _frame
    unit = struct.unpack_from("<I", frame, 9)[0]
    return _frame(unit, body)


@pytest.mark.parametrize("kind", ["crc", "size", "signature", "unknown_cell", "truncated",
                                  "no_navigation", "duplicate_navigation", "bad_coordinates"])
def test_k3_5_malformed_frames_are_rejected(kind):
    frame = bytearray(nav_frame(5, 1_700_000_000, 37.6, 55.7))
    nph = struct.pack("<HHHI", 1, 101, 1, 1)
    if kind == "crc":
        frame[-1] ^= 0xFF
    elif kind == "size":
        struct.pack_into("<H", frame, 2, len(frame))
    elif kind == "signature":
        frame[0] = 0x7F
    elif kind == "unknown_cell":
        frame = _with_body(frame, bytes(frame[15:]) + struct.pack("<BB", 99, 0) + b"\x00" * 4)
    elif kind == "truncated":
        frame = frame[:-3]
    elif kind == "no_navigation":
        frame = _with_body(frame, nph)
    elif kind == "duplicate_navigation":
        frame = _with_body(frame, nph + nav_cell(1, 37.6, 55.7) + nav_cell(2, 37.6, 55.7))
    elif kind == "bad_coordinates":
        frame = _with_body(frame, nph + nav_cell(1, 200.0, 55.7))
    with pytest.raises(ValueError):
        parse_frame(bytes(frame))


async def _send(port, chunks, pause=0.0):
    _, writer = await asyncio.open_connection("127.0.0.1", port)
    try:
        for chunk in chunks:
            writer.write(chunk)
            await writer.drain()
            if pause:
                await asyncio.sleep(pause)
        await asyncio.sleep(0.15)
    finally:
        writer.close()


def test_k3_5_tcp_byte_by_byte_and_several_frames_per_write():
    async def run():
        receiver = Receiver()
        async with tcp_server(receiver.handle) as port:
            now = time.time()
            frame = nav_frame(1, now, 37.6, 55.7)
            await _send(port, [handshake_frame(1)] + [frame[i:i + 1] for i in range(len(frame))])
            await _send(port, [b"".join(nav_frame(2, now + i, 37.6, 55.7) for i in range(3))])
            await asyncio.sleep(0.2)
        return receiver

    receiver = asyncio.run(run())
    assert (receiver.frames, receiver.errors) == (4, 0)
    assert len(receiver.histories[1]) == 1 and len(receiver.histories[2]) == 3


def test_k3_5_garbage_never_crashes_the_receiver_and_valid_data_still_flows():
    rng = random.Random(2026)

    async def run():
        receiver = Receiver()
        async with tcp_server(receiver.handle) as port:
            for i in range(200):
                blob = bytes(rng.getrandbits(8) for _ in range(rng.randint(1, 300)))
                if i % 3 == 0:
                    blob = b"~~" + blob  # passes the signature check, fails later
                try:
                    await _send(port, [blob])
                except ConnectionError:
                    pass
            await _send(port, [nav_frame(3, time.time(), 37.6, 55.7)])
            await asyncio.sleep(0.3)
        return receiver

    receiver = asyncio.run(run())
    record("k3.ndtp_fuzz", {"garbage_connections": 200, "errors_counted": receiver.errors,
                            "valid_frames_after_garbage": len(receiver.histories.get(3, []))})
    assert len(receiver.histories.get(3, [])) == 1


def test_k3_5_late_future_and_unmapped_packets_are_contained():
    async def run():
        receiver = Receiver(allowed_units={10})
        async with tcp_server(receiver.handle) as port:
            now = time.time()
            await _send(port, [nav_frame(10, now, 37.6, 55.7), nav_frame(10, now - 30, 37.6, 55.7)])
            await _send(port, [nav_frame(11, now, 37.6, 55.7)])
            await _send(port, [nav_frame(10, now + 3600, 37.6, 55.7)])
            await asyncio.sleep(0.2)
        return receiver

    receiver = asyncio.run(run())
    assert len(receiver.histories[10]) == 1 and receiver.out_of_order_frames == 1
    assert 11 not in receiver.histories and receiver.ignored_units == 1
    assert receiver.errors == 1


def test_k3_5_one_bad_frame_closes_only_its_connection():
    """Documents the behaviour: an invalid frame drops the rest of that TCP session."""
    async def run():
        receiver = Receiver()
        async with tcp_server(receiver.handle) as port:
            now = time.time()
            bad = bytearray(nav_frame(4, now, 37.6, 55.7))
            bad[-1] ^= 0xFF
            await _send(port, [nav_frame(4, now, 37.6, 55.7) + bytes(bad) + nav_frame(4, now + 1, 37.6, 55.7)])
            await _send(port, [nav_frame(4, now + 2, 37.6, 55.7)])
            await asyncio.sleep(0.2)
        return receiver

    receiver = asyncio.run(run())
    record("k3.ndtp_frames_lost_after_bad_frame_in_same_session", 1 if len(receiver.histories[4]) == 2 else 0)
    assert receiver.errors == 1 and len(receiver.histories[4]) >= 2


@pytest.mark.xfail(strict=True, reason="Door status (IRMA) is not decoded: the layout is absent in the supplied spec")
def test_k3_7_door_status_is_decoded():
    row = parse_frame(nav_frame(1, 1_700_000_000, 37.6, 55.7))
    assert any("door" in key for key in row)


# --- 3.6 Schedule matching and derived features

def _synthetic_archive(folder: Path, t: pd.Timestamp):
    """Moving 36 km/h until T-160 s, then standing still; a target 12 minutes ahead."""
    rows = []
    for k in range(61):
        ts = t - pd.Timedelta(seconds=600 - 10 * k)
        moving = ts <= t - pd.Timedelta(seconds=160)
        rows.append({"tr_id": 1, "unit_id": 11, "event_time": ts.strftime("%Y-%m-%d %H:%M:%S"),
                     "location_valid": True, "lon": STOP_LON, "lat": STOP_LAT + (0.0001 * k if moving else 0.0044),
                     "speed": 36.0 if moving else 0.0, "heading": 0.0})
    folder.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(folder / "traffic.csv", index=False)
    target = t + pd.Timedelta(seconds=720)
    pd.DataFrame([{
        "tt_action_item_id": 42, "tr_id": 1, "time_begin": target.strftime("%Y-%m-%d %H:%M:%S"),
        "geom": f"POINT ({STOP_LON} {STOP_LAT + 0.03})", "building_address": "Цель",
    }]).to_csv(folder / "schedule.csv", index=False)
    return target


def test_k3_6_backend_features_speed_dwell_and_deviation_are_correct(tmp_path):
    from transit_ml.features import Dataset, distance

    t = pd.Timestamp("2026-09-26 12:00:00")
    target = _synthetic_archive(tmp_path, t)
    dataset = Dataset(tmp_path)
    f = dataset.feature({"tr_id": 1, "T": str(t), "target_stop_id": 42,
                         "target_time_begin": str(target), "cur_dev_s": 95.0})
    assert f["cur_dev_s"] == 95.0 and f["horizon_s"] == 720
    assert f["dwell_s"] == pytest.approx(160, abs=0.5)          # time standing still
    assert f["speed_mean_120"] == pytest.approx(0.0)
    assert f["speed_mean_600"] == pytest.approx(36 * 45 / 61, abs=0.01)
    assert f["stopped_ratio_600"] == pytest.approx(16 / 61, abs=1e-3)
    expected = distance(STOP_LON, STOP_LAT + 0.0044, STOP_LON, STOP_LAT + 0.03)
    assert f["distance_target_m"] == pytest.approx(expected, rel=1e-6)
    assert f["required_speed_kmh"] == pytest.approx(expected / 720 * 3.6, rel=1e-6)


def test_k3_6_model_features_windows_are_causal_and_correct(tmp_path):
    from mt_hack.features import build_features

    t = pd.Timestamp("2026-09-26 12:00:00")
    target = _synthetic_archive(tmp_path, t)
    traffic = pd.read_csv(tmp_path / "traffic.csv")
    plan = pd.read_csv(tmp_path / "schedule.csv")
    point = pd.DataFrame([{"sample_id": "a", "tr_id": 1, "T": str(t), "target_stop_id": 42,
                           "target_time_begin": str(target), "cur_dev_s": 95.0}])
    x, seq = build_features(point, traffic, plan)
    assert x.count_600.iloc[0] == 60                     # (T-600, T]
    assert x.speed_mean_600.iloc[0] == pytest.approx(36 * 44 / 60, abs=1e-6)
    assert x.stop_frac_600.iloc[0] == pytest.approx(16 / 60, abs=1e-6)
    assert x.stop_frac_60.iloc[0] == 1.0 and x.telemetry_age_s.iloc[0] == 0
    assert seq.shape == (1, 30, 8)


def test_k3_6_live_deviation_comes_from_a_stop_the_bus_is_standing_at(tmp_path, monkeypatch):
    from transit_ml.backend import Engine

    now = time.time()
    write_live_plan(tmp_path, [(6001, 601), (6002, 602)], now, previous_offset=-300)
    monkeypatch.setenv("TELEMETRY_MODE", "ndtp")
    monkeypatch.setenv("LIVE_PLAN_DIR", str(tmp_path))

    async def run():
        engine = Engine()
        import httpx

        engine.client = httpx.AsyncClient(transport=httpx.MockTransport(
            lambda r: httpx.Response(503)))
        for unit, speed in ((6001, 0), (6002, 30)):
            lon = STOP_LON + (0 if unit == 6001 else 0.01)
            engine.receiver.histories[unit] = deque([{
                "unit_id": unit, "ts": now, "lon": lon, "lat": STOP_LAT,
                "location_valid": True, "speed": speed, "heading": 0, "alt": 1}], maxlen=1500)
        snapshot = await engine.snapshot()
        await engine.client.aclose()
        return {v["id"]: v for v in snapshot["vehicles"]}

    vehicles = asyncio.run(run())
    assert vehicles["vehicle-601"]["current_delay_sec"] == pytest.approx(300, abs=2)
    assert vehicles["vehicle-602"]["current_delay_sec"] is None  # moving: not an observed stop


def test_k3_6_segment_speed_dwell_and_deviation_between_observed_stops():
    """Stop-to-stop segment: 30 s standing at A, 90 s at 36 km/h, arrives at B 70 s early."""
    from transit_ml.segments import SegmentMatcher

    t0 = 1_800_000_000.0
    plan = pd.DataFrame([
        {"tt_action_item_id": 1, "ts": t0, "lon": STOP_LON, "lat": STOP_LAT, "building_address": "A"},
        {"tt_action_item_id": 2, "ts": t0 + 240, "lon": STOP_LON, "lat": STOP_LAT + 0.009, "building_address": "B"},
        {"tt_action_item_id": 3, "ts": t0 + 480, "lon": STOP_LON, "lat": STOP_LAT + 0.018, "building_address": "C"},
    ])
    rows = [(t0 + s, STOP_LAT, 0.0) for s in (30, 40, 50, 60)]
    rows += [(t0 + 70 + 10 * i, STOP_LAT + 0.0009 * (i + 1), 36.0) for i in range(10)]
    rows += [(t0 + s, STOP_LAT + 0.009, 0.0) for s in (170, 180, 190, 200)]
    rows += [(t0 + 260, STOP_LAT + 0.5, 90.0)]  # after the cutoff: must be ignored
    history = pd.DataFrame([{"ts": ts, "lon": STOP_LON, "lat": lat, "speed": speed,
                             "location_valid": True} for ts, lat, speed in rows])
    result = SegmentMatcher(plan, route_id="duty-1").match(history, t0 + 200)
    assert result["status"] == "matched"
    assert [round(v["delay_sec"]) for v in result["stop_visits"]] == [30, -70]
    first = next(s for s in result["segments"] if s["from_stop_id"] == "1")
    assert first["complete"] and first["to_stop_id"] == "2"
    assert first["mean_speed_kmh"] == pytest.approx(3600 / 140, abs=0.01)  # time-weighted
    assert first["dwell_sec"] == pytest.approx(30.0)
    assert result["current_delay_sec"] == pytest.approx(-70)
    record("k3.segment_example", {k: first[k] for k in ("mean_speed_kmh", "dwell_sec", "observed_distance_m")})


# --- 3.4 / 3.9 API specification and generated documentation

def test_k3_4_ml_swagger_answers_and_lists_the_prediction_endpoints():
    from fastapi.testclient import TestClient
    from transit_ml.inference import app

    with TestClient(app) as client:
        docs = client.get("/docs")
        schema = client.get("/openapi.json").json()
        health = client.get("/health").json()
    assert docs.status_code == 200 and "swagger-ui" in docs.text.lower()
    assert {"/health", "/predict", "/predict/raw"} <= set(schema["paths"])
    assert schema["openapi"].startswith("3.")
    assert health["status"] == "ok" and health["modelVersion"]


def test_k3_4_backend_swagger_and_status_answer(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    write_live_plan(tmp_path, [(7001, 701)], time.time())
    monkeypatch.setenv("TELEMETRY_MODE", "ndtp")
    monkeypatch.setenv("LIVE_PLAN_DIR", str(tmp_path))
    monkeypatch.setenv("NDTP_PORT", "0")
    from transit_ml import backend

    with TestClient(backend.app) as client:
        docs = client.get("/docs")
        schema = client.get("/openapi.json").json()
        status = client.get("/status")
    assert docs.status_code == 200 and "swagger-ui" in docs.text.lower()
    assert {"/snapshot", "/status", "/catalog", "/warnings/audit"} <= set(schema["paths"])
    assert status.status_code == 200 and status.json()["mode"] == "official-ndtp"


@needs_data
def test_k3_8_backend_replay_serves_positions_forecasts_and_audit(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("REPLAY_SPEED", "0")
    monkeypatch.setenv("NDTP_PORT", "0")
    from transit_ml import backend

    with TestClient(backend.app) as client:
        snapshot = client.get("/snapshot").json()
        status = client.get("/status").json()
        audit = client.get("/warnings/audit")
    assert snapshot["vehicles"] and status["mode"] == "official-replay"
    assert status["locatedVehicles"] == len(snapshot["vehicles"])
    assert audit.status_code == 200


PY_DOC_MODULES = {
    "transit_ml.backend": "ml/transit_ml/backend.py",
    "transit_ml.features": "ml/transit_ml/features.py",
    "transit_ml.inference": "ml/transit_ml/inference.py",
    "transit_ml.ndtp": "ml/transit_ml/ndtp.py",
    "mt_hack.features": "src/mt_hack/features.py",
}


def test_k3_9_pydoc_pages_cover_every_public_symbol_of_the_shipped_modules():
    docs = ROOT / "public/docs/python"
    index = (docs / "index.html").read_text(encoding="utf-8")
    stale = {}
    for module, source in PY_DOC_MODULES.items():
        html = (docs / f"{module}.html").read_text(encoding="utf-8")
        tree = ast.parse((ROOT / source).read_text(encoding="utf-8"))
        public = [node.name for node in tree.body
                  if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
                  and not node.name.startswith("_")]
        missing = [name for name in public if name not in html]
        if missing:
            stale[module] = missing
        assert f'href="{module}.html"' in index
    assert not stale, f"PyDoc is older than the code: {stale}"
