from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from mt_hack.features import load_split, seconds

MAJOR = {"motorway", "trunk", "primary", "secondary", "tertiary"}
LINK = {f"{name}_link" for name in MAJOR}
BUS_KEYS = {
    "busway",
    "busway:left",
    "busway:right",
    "busway:both",
    "lanes:bus",
    "lanes:bus:forward",
    "lanes:bus:backward",
    "bus:lanes",
    "bus:lanes:forward",
    "bus:lanes:backward",
    "psv:lanes",
    "psv:lanes:forward",
    "psv:lanes:backward",
}


def _float_from_tag(value):
    if value is None:
        return None
    match = re.search(r"\d+(?:\.\d+)?", str(value).replace(",", "."))
    return float(match.group()) if match else None


def _is_busway(tags):
    if any(key in tags for key in BUS_KEYS):
        values = " ".join(str(tags.get(key, "")) for key in BUS_KEYS).lower()
        if any(token in values for token in ("yes", "designated", "lane", "opposite")):
            return True
    highway = str(tags.get("highway", "")).lower()
    return highway in {"busway", "bus_guideway"}


def _normalize_snapshot(value: str) -> str:
    ts = pd.to_datetime(value, utc=True)
    if pd.isna(ts):
        raise ValueError(f"Invalid snapshot date: {value}")
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def _prediction_time_bounds(data_root: str | Path) -> tuple[pd.Timestamp, pd.Timestamp]:
    values = []
    for split in ("train", "test", "validate"):
        points, _, _ = load_split(data_root, split)
        parsed = pd.to_datetime(points["T"], format="mixed", utc=True)
        values.extend(parsed.tolist())
    if not values:
        raise RuntimeError("No prediction points found in official data")
    return min(values), max(values)


def _resolve_snapshot(data_root: str | Path, requested: str) -> tuple[str, str, str]:
    earliest, latest = _prediction_time_bounds(data_root)
    if requested.lower() == "auto":
        snapshot = earliest - pd.Timedelta(seconds=1)
    else:
        snapshot = pd.to_datetime(requested, utc=True)
        if pd.isna(snapshot):
            raise ValueError(f"Invalid --snapshot: {requested}")
        if snapshot >= earliest:
            raise ValueError(
                "Historical OSM snapshot must be strictly earlier than the earliest "
                f"prediction T ({earliest.strftime('%Y-%m-%dT%H:%M:%SZ')})."
            )
    return (
        snapshot.strftime("%Y-%m-%dT%H:%M:%SZ"),
        earliest.strftime("%Y-%m-%dT%H:%M:%SZ"),
        latest.strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


def _query_overpass(endpoint, south, west, north, east, timeout, snapshot_date):
    query = f"""
[out:json][timeout:{timeout}][date:\"{snapshot_date}\"];
(
  way[\"highway\"]({south},{west},{north},{east});
  node[\"highway\"=\"traffic_signals\"]({south},{west},{north},{east});
);
out meta;
""".strip()
    body = urllib.parse.urlencode({"data": query}).encode()
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={"User-Agent": "mt-hack/1.1 historical-osm-feature-prep"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout + 30) as response:
        return json.loads(response.read())


def _validate_historical_payload(payload, snapshot_date):
    remark = str(payload.get("remark", "")).strip()
    if remark:
        raise RuntimeError(f"Overpass returned remark: {remark}")

    cutoff = pd.to_datetime(snapshot_date, utc=True)
    missing_timestamp = 0
    after_snapshot = []
    for element in payload.get("elements", []):
        value = element.get("timestamp")
        if value is None:
            missing_timestamp += 1
            continue
        timestamp = pd.to_datetime(value, utc=True)
        if timestamp > cutoff:
            after_snapshot.append((element.get("type"), element.get("id"), value))

    if missing_timestamp:
        raise RuntimeError(
            "Overpass response is missing element timestamps. The script uses 'out meta' "
            "to verify that the server actually returned an attic snapshot; refusing to "
            "cache an unverifiable response."
        )
    if after_snapshot:
        preview = after_snapshot[:3]
        raise RuntimeError(
            f"Overpass returned {len(after_snapshot)} element(s) newer than "
            f"snapshot {snapshot_date}: {preview}. The endpoint may not support attic data."
        )


def _aggregate(payload):
    ways = [e for e in payload.get("elements", []) if e.get("type") == "way"]
    signals = [
        e
        for e in payload.get("elements", [])
        if e.get("type") == "node"
        and e.get("tags", {}).get("highway") == "traffic_signals"
    ]
    node_use = Counter()
    highway_classes = []
    lanes = []
    speeds = []
    busways = 0
    roundabouts = 0
    for way in ways:
        tags = way.get("tags", {})
        highway = str(tags.get("highway", "")).lower()
        highway_classes.append(highway)
        for node_id in way.get("nodes", []):
            node_use[node_id] += 1
        lane_value = _float_from_tag(tags.get("lanes"))
        if lane_value is not None:
            lanes.append(lane_value)
        speed_value = _float_from_tag(tags.get("maxspeed"))
        if speed_value is not None:
            if "mph" in str(tags.get("maxspeed", "")).lower():
                speed_value *= 1.609344
            speeds.append(speed_value)
        busways += int(_is_busway(tags))
        roundabouts += int(tags.get("junction") == "roundabout")
    count = len(ways)
    return {
        "road_count": count,
        "signal_count": len(signals),
        "intersection_count": sum(v >= 2 for v in node_use.values()),
        "busway_count": busways,
        "major_road_frac": (sum(x in MAJOR for x in highway_classes) / count) if count else 0.0,
        "link_road_frac": (sum(x in LINK for x in highway_classes) / count) if count else 0.0,
        "roundabout_count": roundabouts,
        "lanes_median": float(np.median(lanes)) if lanes else None,
        "maxspeed_median": float(np.median(speeds)) if speeds else None,
    }


def _target_coords(plan):
    coords = plan.geom.str.extract(r"POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)").astype(float)
    copy = plan[["tr_id", "tt_action_item_id"]].copy()
    copy["lon"] = coords[0]
    copy["lat"] = coords[1]
    return copy.drop_duplicates(["tr_id", "tt_action_item_id"])


def _needed_coordinates(data_root):
    coordinates = []
    for split in ("train", "test", "validate"):
        points, traffic, plan = load_split(data_root, split)
        traffic = traffic.copy()
        traffic["_t"] = seconds(traffic.event_time)
        traffic["valid"] = (
            traffic.location_valid.astype(str).str.lower().eq("true")
            & traffic.lon.between(-180, 180)
            & traffic.lat.between(-90, 90)
        )
        groups = {k: g.sort_values("_t") for k, g in traffic.groupby("tr_id", sort=False)}
        point_times = seconds(points["T"])
        for row, t in zip(points.to_dict("records"), point_times):
            group = groups.get(row["tr_id"])
            if group is None:
                continue
            valid = group[(group["_t"] <= t) & group["valid"]]
            if len(valid):
                coordinates.append((float(valid.lon.iloc[-1]), float(valid.lat.iloc[-1])))
        targets = points[["tr_id", "target_stop_id"]].merge(
            _target_coords(plan),
            left_on=["tr_id", "target_stop_id"],
            right_on=["tr_id", "tt_action_item_id"],
            how="left",
        )
        for lon, lat in targets[["lon", "lat"]].to_numpy():
            if np.isfinite(lon) and np.isfinite(lat):
                coordinates.append((float(lon), float(lat)))
    return coordinates


def _cell_key(lon, lat, cell_deg):
    return math.floor(lon / cell_deg), math.floor(lat / cell_deg)


def _backup_incompatible_cache(path: Path, reason: str):
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = path.with_name(f"{path.stem}.backup-{stamp}{path.suffix}")
    shutil.copy2(path, backup)
    print(f"Existing cache is not reusable ({reason}).", flush=True)
    print(f"Backed it up to {backup}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="ml/data/official")
    parser.add_argument("--out", default="ml/data/external/osm_cells.json")
    parser.add_argument("--cell-deg", type=float, default=0.03)
    parser.add_argument("--endpoint", default="https://overpass-api.de/api/interpreter")
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--sleep", type=float, default=3.0)
    parser.add_argument("--retries", type=int, default=8)
    parser.add_argument(
        "--snapshot",
        default="auto",
        help=(
            "OSM snapshot timestamp in ISO-8601 UTC, or 'auto'. 'auto' uses one second "
            "before the earliest prediction T across train/test/validate."
        ),
    )
    args = parser.parse_args()

    snapshot_date, earliest_t, latest_t = _resolve_snapshot(args.data, args.snapshot)
    print(f"Prediction T range: {earliest_t} .. {latest_t}", flush=True)
    print(f"Historical OSM snapshot: {snapshot_date}", flush=True)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    existing = {
        "historical": True,
        "snapshot_date": snapshot_date,
        "earliest_prediction_t": earliest_t,
        "latest_prediction_t": latest_t,
        "cell_deg": args.cell_deg,
        "cells": {},
    }

    if out.is_file():
        payload = json.loads(out.read_text())
        cached_snapshot = payload.get("snapshot_date")
        cached_historical = payload.get("historical") is True
        cached_cell_deg = float(payload.get("cell_deg", args.cell_deg))
        reason = None
        if not cached_historical or not cached_snapshot:
            reason = "legacy/current OSM cache has no verified historical snapshot metadata"
        elif _normalize_snapshot(cached_snapshot) != snapshot_date:
            reason = f"snapshot {cached_snapshot} != requested {snapshot_date}"
        elif abs(cached_cell_deg - args.cell_deg) > 1e-12:
            reason = f"cell_deg {cached_cell_deg} != requested {args.cell_deg}"

        if reason is None:
            existing = payload
            existing["historical"] = True
            existing["snapshot_date"] = snapshot_date
            existing["earliest_prediction_t"] = earliest_t
            existing["latest_prediction_t"] = latest_t
        else:
            _backup_incompatible_cache(out, reason)

    coords = _needed_coordinates(args.data)
    keys = sorted({_cell_key(lon, lat, args.cell_deg) for lon, lat in coords})
    print(f"Need {len(keys)} OSM cells; {len(existing['cells'])} already cached", flush=True)

    for index, (x, y) in enumerate(keys, start=1):
        key = f"{x}:{y}"
        if key in existing["cells"]:
            continue
        west = x * args.cell_deg
        east = (x + 1) * args.cell_deg
        south = y * args.cell_deg
        north = (y + 1) * args.cell_deg
        error = None
        for attempt in range(args.retries):
            try:
                payload = _query_overpass(
                    args.endpoint,
                    south,
                    west,
                    north,
                    east,
                    args.timeout,
                    snapshot_date,
                )
                _validate_historical_payload(payload, snapshot_date)
                existing["cells"][key] = _aggregate(payload)
                existing["endpoint"] = args.endpoint
                existing["generated_at_utc"] = datetime.now(timezone.utc).strftime(
                    "%Y-%m-%dT%H:%M:%SZ"
                )
                out.write_text(json.dumps(existing, ensure_ascii=False, indent=2))
                print(f"[{index}/{len(keys)}] {key} ok", flush=True)
                error = None
                break
            except (
                urllib.error.URLError,
                TimeoutError,
                json.JSONDecodeError,
                RuntimeError,
            ) as exc:
                error = exc
                wait = args.sleep * (2**attempt)
                print(
                    f"[{index}/{len(keys)}] {key} failed: {exc}; retry in {wait:.1f}s",
                    flush=True,
                )
                time.sleep(wait)
        if error is not None:
            raise SystemExit(f"Failed to fetch {key}: {error}")
        time.sleep(args.sleep)

    print(f"Saved {len(existing['cells'])} historical cells to {out}", flush=True)
    print(f"Verified snapshot_date={snapshot_date}", flush=True)


if __name__ == "__main__":
    main()
