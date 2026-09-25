"""Build a small, offline road-aligned reference map for the official replay.

This is cartographic context only. It must never feed ML features or imply that
the vehicle had already traversed the whole line at the replay timestamp.

Usage: PYTHONPATH=ml ml/.venv/bin/python scripts/build-official-road-routes.py
The OSRM demo permits at most one request per second; this script waits 1.2s.
"""

import argparse
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

from transit_ml.features import seconds


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/data/official-road-routes.json"
# The checked-in map must describe the same part of the archive as the
# dashboard's initial replay. The former 17:50 reference was ten hours away
# from REPLAY_START (07:27), so it drew unrelated afternoon journeys.
REFERENCE = pd.Timestamp("2026-01-06T07:27:00Z").timestamp()
WINDOW_SECONDS = 3600
OSRM = "https://router.project-osrm.org/route/v1/driving/"
USER_AGENT = "MT-Hackathon-TransitHub/0.1 (noncommercial hackathon; github.com/Belorus-ne-vykupaet/mt-hack)"
LAST_REQUEST = 0.0


def metres(a, b):
    return math.hypot(
        (b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2)),
        b[1] - a[1],
    ) * 111195


def representative_window(gps):
    """Only draw a duty if its GPS is present near the displayed replay time."""
    near = gps[gps.ts.between(REFERENCE - WINDOW_SECONDS, REFERENCE + WINDOW_SECONDS)]
    if len(near) < 3 or not gps.ts.between(REFERENCE - 180, REFERENCE).any():
        return None
    return REFERENCE - WINDOW_SECONDS, REFERENCE + WINDOW_SECONDS


def distance_to_paths(point, paths):
    """Shortest distance to a rendered road edge, including its interior."""
    scale = math.cos(math.radians(point[1]))
    closest = math.inf
    for path in paths:
        for a, b in zip(path, path[1:]):
            dx, dy = (b[0] - a[0]) * scale, b[1] - a[1]
            t = max(0, min(1, ((point[0] - a[0]) * scale * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy or 1)))
            closest = min(closest, metres(point, (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)))
    return closest


def clean_gps(gps, lo, hi):
    frame = gps[gps.ts.between(lo, hi)].sort_values("ts", kind="stable")
    chunks, chunk = [], []
    previous = None
    for row in frame.itertuples():
        point = (float(row.lon), float(row.lat))
        if previous is not None:
            elapsed = max(0, float(row.ts - previous[0]))
            jump = metres(previous[1], point)
            if elapsed > 180 or jump > max(180, elapsed * 30):
                if len(chunk) > 2:
                    chunks.append(chunk)
                chunk = []
        if not chunk or metres(chunk[-1], point) >= 65:
            chunk.append(point)
        previous = (float(row.ts), point)
    if len(chunk) > 2:
        chunks.append(chunk)
    # One bus can circle the same area many times; keep the longest coherent
    # observed runs rather than drawing a day's worth of overlapping loops.
    return sorted(chunks, key=lambda c: sum(metres(a, b) for a, b in zip(c, c[1:])), reverse=True)[:3]


def plan_stops(plan, lo, hi):
    frame = plan[plan.ts.between(lo, hi)].sort_values("ts", kind="stable")
    chunks, chunk, previous = [], [], None
    for row in frame.itertuples():
        point = (float(row.lon), float(row.lat))
        if not all(math.isfinite(x) for x in point):
            continue
        if previous is not None and (row.ts - previous[0] > 2400 or metres(previous[1], point) > 5000):
            if len(chunk) > 2:
                chunks.append(chunk)
            chunk = []
        if not chunk or metres(chunk[-1], point) >= 35:
            chunk.append(point)
        previous = (float(row.ts), point)
    if len(chunk) > 2:
        chunks.append(chunk)
    return sorted(chunks, key=lambda c: sum(metres(a, b) for a, b in zip(c, c[1:])), reverse=True)[:2]


def request_road(points):
    global LAST_REQUEST
    wait = 1.2 - (time.monotonic() - LAST_REQUEST)
    if wait > 0:
        time.sleep(wait)
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lon, lat in points)
    url = OSRM + coords + "?" + urllib.parse.urlencode({"geometries": "geojson", "overview": "full"})
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    LAST_REQUEST = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            result = json.load(response)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        print("  OSRM unavailable:", str(error)[:140], flush=True)
        return None
    if result.get("code") != "Ok" or not result.get("routes"):
        print("  OSRM rejected route:", result.get("code"), flush=True)
        return None
    if any(w["distance"] > 130 for w in result["waypoints"]):
        print("  discarded: waypoint farther than 130 m from road", flush=True)
        return None
    route = result["routes"][0]
    direct = sum(metres(a, b) for a, b in zip(points, points[1:]))
    if direct < 100 or route["distance"] > 4 * direct + 800:
        print("  discarded: implausible road detour", flush=True)
        return None
    coordinates = [[round(lon, 6), round(lat, 6)] for lon, lat in route["geometry"]["coordinates"]]
    return [p for i, p in enumerate(coordinates) if not i or p != coordinates[i - 1]]


def route_pieces(points):
    for chunk in points:
        # The public demo accepts a limited number of waypoints. Overlap one
        # point to preserve continuity without creating a straight bridge.
        for start in range(0, len(chunk) - 1, 39):
            piece = chunk[start : start + 40]
            if len(piece) < 3:
                continue
            road = request_road(piece)
            if road and len(road) >= 2:
                yield road


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="regenerate the checked-in offline cache")
    args = parser.parse_args()
    if OUTPUT.exists() and not args.force:
        print(f"{OUTPUT} already exists; pass --force to regenerate")
        return
    data = ROOT / "ml/data/official/test"
    traffic = pd.read_csv(data / "traffic.csv", low_memory=False)
    traffic["ts"] = seconds(traffic.event_time)
    traffic = traffic[
        traffic.location_valid.eq(True)
        & traffic.lon.between(37.0, 38.0)
        & traffic.lat.between(55.4, 56.1)
    ].sort_values("ts", kind="stable")
    schedule = pd.read_csv(data / "schedule.csv", usecols=["tr_id", "time_begin", "geom"])
    schedule["ts"] = seconds(schedule.time_begin)
    xy = schedule.geom.str.extract(r"POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)").astype(float)
    schedule["lon"], schedule["lat"] = xy[0], xy[1]
    # The CSV rows are shuffled. Routing in file order would create a maze of
    # unrelated stop-to-stop journeys despite every individual leg using roads.
    schedule = schedule.sort_values("ts", kind="stable")
    records = []
    for tr, gps in traffic.groupby("tr_id"):
        window = representative_window(gps)
        if window is None:
            continue
        lo, hi = window
        plan = schedule[schedule.tr_id.eq(tr)]
        stops = plan_stops(plan, lo, hi)
        source = "schedule-stops" if stops else "gps-trace"
        candidates = stops or clean_gps(gps, lo, hi)
        paths = list(route_pieces(candidates))
        latest = gps[gps.ts.le(REFERENCE)].iloc[-1]
        current_point = (float(latest.lon), float(latest.lat))
        # A schedule may contain another branch or trip for this vehicle.
        # Do not display it beside a bus on a different street.
        if stops and (not paths or distance_to_paths(current_point, paths) > 120):
            source = "gps-trace"
            paths = list(route_pieces(clean_gps(gps, lo, hi)))
        if paths and distance_to_paths(current_point, paths) > 120:
            paths = []
        if paths:
            records.append({
                "routeId": f"duty-{int(tr)}",
                "source": source,
                "window": [pd.Timestamp(lo, unit="s", tz="UTC").isoformat(), pd.Timestamp(hi, unit="s", tz="UTC").isoformat()],
                "paths": paths,
            })
        print(f"{int(tr)}: {source}, {len(paths)} road sections, {sum(len(p) for p in paths)} vertices", flush=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({
        "version": 1,
        "description": "Road reference around the replay start, not ML input or evidence of future observed movement",
        "source": {
            "traffic": "official test/traffic.csv",
            "schedule": "official test/schedule.csv",
            "roads": "© OpenStreetMap contributors (ODbL 1.0), routed with OSRM",
            "roadUrl": "https://www.openstreetmap.org/copyright",
            "routerUrl": "https://project-osrm.org/",
        },
        "routes": records,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"saved {len(records)} vehicles: {OUTPUT}")


if __name__ == "__main__":
    main()
