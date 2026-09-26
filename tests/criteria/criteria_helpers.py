"""Shared helpers for the criteria audit (official PDF, criteria 1–5).

Tests that need the organizers' archive skip with an explicit reason when it
is absent; CI prepares the archive. Measured numbers go to
reports/criteria/metrics.json so the final grading can cite them.
"""

import asyncio
import csv
import json
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.request
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
for path in (ROOT / "ml", ROOT / "src"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

DATA = Path(os.getenv("OFFICIAL_DATA_DIR", str(ROOT / "ml" / "data" / "official"))).resolve()
REPORT_DIR = Path(os.getenv("CRITERIA_REPORT_DIR", str(ROOT / "reports" / "criteria")))
HAS_DATA = (DATA / "test" / "traffic.csv").exists()
needs_data = pytest.mark.skipif(
    not HAS_DATA, reason=f"official archive is not prepared in {DATA}"
)

METRICS = {}


def record(key, value):
    """Keep a measured value for the criteria report."""
    METRICS[key] = value


def percentiles(values):
    values = np.asarray(values, dtype=float)
    if not len(values):
        return None
    return {
        "n": int(len(values)),
        "p50": round(float(np.percentile(values, 50)), 2),
        "p95": round(float(np.percentile(values, 95)), 2),
        "max": round(float(values.max()), 2),
    }


# --- NDTP encoder written from the protocol description, independent of the parser.

def crc16_modbus(data: bytes) -> int:
    """Standard CRC-16/MODBUS (poly 0xA001 reflected, init 0xFFFF)."""
    crc = 0xFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def _frame(unit: int, body: bytes) -> bytes:
    crc = crc16_modbus(body)
    swapped = ((crc & 0xFF) << 8) | (crc >> 8)  # the specification swaps the byte order
    return struct.pack("<HHHHBIH", 0x7E7E, len(body), 0, swapped, 2, unit, 0) + body


def nav_cell(ts, lon, lat, speed=0, heading=0, valid=True, altitude=150):
    flags = (128 if valid else 0) | (64 if lon >= 0 else 0) | (32 if lat >= 0 else 0)
    return struct.pack("<BB", 0, 0) + struct.pack(
        "<IIIBBHHHHHBB",
        int(ts),
        round(abs(lon) * 1e7),
        round(abs(lat) * 1e7),
        flags,
        100,
        int(speed),
        int(speed),
        int(heading) % 360,
        0,
        int(altitude) % 65536,
        9,
        1,
    )


def nav_frame(unit, ts, lon, lat, speed=0, heading=0, valid=True, altitude=150, extra=b""):
    body = struct.pack("<HHHI", 1, 101, 1, 1) + nav_cell(
        ts, lon, lat, speed, heading, valid, altitude
    ) + extra
    return _frame(unit, body)


def handshake_frame(unit):
    body = struct.pack("<HHHI", 0, 100, 0, 1) + struct.pack("<HHHIII", 6, 2, 0, unit, 0, 0)
    return _frame(unit, body)


# --- Synthetic current plan for NDTP-mode tests (never the January archive).

STOP_LON, STOP_LAT = 37.6173, 55.7551


def write_live_plan(folder: Path, units, now: float, previous_offset=-600,
                    target_offsets=(720,), spacing_deg=0.01):
    """One previous stop at the bus position (observed deviation) and later targets.

    ``units`` is a list of (unit_id, tr_id); vehicle i stands at its own position.
    """
    from datetime import datetime, timezone

    folder.mkdir(parents=True, exist_ok=True)
    rows = []
    positions = {}
    for i, (unit, tr) in enumerate(units):
        lon = STOP_LON + (i % 20) * spacing_deg
        lat = STOP_LAT + (i // 20) * spacing_deg
        positions[unit] = (lon, lat)
        stamp = lambda offset: datetime.fromtimestamp(now + offset, timezone.utc).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        rows.append((tr * 100, stamp(previous_offset), tr, lon, lat, f"Стенд {tr} · прошлая"))
        for j, offset in enumerate(target_offsets):
            rows.append(
                (tr * 100 + 1 + j, stamp(offset), tr, lon, lat + 0.05, f"Стенд {tr} · цель {j + 1}")
            )
    with (folder / "schedule_plan.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("tt_action_item_id", "time_begin", "tr_id", "geom", "building_address"))
        for stop_id, when, tr, lon, lat, name in rows:
            writer.writerow((stop_id, when, tr, f"POINT ({lon:.7f} {lat:.7f})", name))
    (folder / "unit-map.json").write_text(
        json.dumps({str(unit): tr for unit, tr in units}), encoding="utf-8"
    )
    return positions


@asynccontextmanager
async def tcp_server(handler):
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    async with server:
        yield port


@asynccontextmanager
async def in_process_ml():
    """The real ML service (loaded weights) behind an in-memory HTTP transport."""
    import httpx
    from transit_ml.inference import app

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://ml", timeout=60
        ) as client:
            yield client, app


@contextmanager
def ml_process():
    """The ML service in its own process (uvicorn), as in the ml container."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = {**os.environ, "PYTHONPATH": os.pathsep.join((str(ROOT / "ml"), str(ROOT / "src")))}
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "transit_ml.inference:app", "--host", "127.0.0.1",
         "--port", str(port), "--no-access-log"],
        cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 90
        while True:
            try:
                urllib.request.urlopen(url + "/health", timeout=2).read()
                break
            except OSError:
                if time.monotonic() > deadline or process.poll() is not None:
                    raise RuntimeError("ML service did not start")
                time.sleep(0.5)
        yield url
    finally:
        process.terminate()
        process.wait(15)
