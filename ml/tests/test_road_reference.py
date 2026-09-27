"""Guard the checked-in offline OSM road reference against malformed paths."""

import json
import importlib.util
import math
from pathlib import Path

import pandas as pd


def test_official_road_reference_is_bounded_and_attributed():
    root = Path(__file__).resolve().parents[2]
    artifact = json.loads((root / "public/data/official-road-routes.json").read_text())
    assert "OpenStreetMap" in artifact["source"]["roads"]
    assert "ODbL" in artifact["source"]["roads"]
    # Only duties present near the replay start have a line. Archive-only
    # duties must not add unrelated afternoon routes to the live morning map.
    assert len(artifact["routes"]) >= 10
    assert len({route["routeId"] for route in artifact["routes"]}) == len(artifact["routes"])
    for route in artifact["routes"]:
        assert route["source"] in {"schedule-stops", "gps-trace"}
        assert route["paths"]
        for path in route["paths"]:
            assert len(path) >= 2
            assert all(
                len(point) == 2
                and all(math.isfinite(value) for value in point)
                and 37.0 <= point[0] <= 38.0
                and 55.4 <= point[1] <= 56.1
                for point in path
            )
            # A large coordinate jump means independent pieces were accidentally
            # concatenated into an aerial straight line.
            assert all(
                math.hypot(
                    (b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2)),
                    b[1] - a[1],
                ) * 111195 < 500
                for a, b in zip(path, path[1:])
            )


def test_plan_points_follow_full_timestamp_even_when_csv_rows_are_shuffled():
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "build_official_road_routes", root / "scripts/build-official-road-routes.py"
    )
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    shuffled = pd.DataFrame([
        {"ts": 3, "lon": 37.603, "lat": 55.7},
        {"ts": 1, "lon": 37.601, "lat": 55.7},
        {"ts": 2, "lon": 37.602, "lat": 55.7},
    ])
    assert builder.plan_stops(shuffled, 0, 4) == [[
        (37.601, 55.7), (37.602, 55.7), (37.603, 55.7)
    ]]


def test_road_reference_is_near_each_bus_at_replay_start():
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "build_official_road_routes", root / "scripts/build-official-road-routes.py"
    )
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    reference = json.loads((root / "public/data/official-road-routes.json").read_text())
    traffic = pd.read_csv(root / "ml/data/official/test/traffic.csv", low_memory=False)
    traffic["ts"] = builder.seconds(traffic.event_time)
    traffic = traffic[traffic.location_valid.eq(True) & traffic.ts.le(builder.REFERENCE)]
    for route in reference["routes"]:
        tr = int(route["routeId"].removeprefix("duty-"))
        gps = traffic[traffic.tr_id.eq(tr)].sort_values("ts").iloc[-1]
        assert builder.REFERENCE - gps.ts <= 180
        assert route["window"][0] <= "2026-01-06T07:27:00+00:00" <= route["window"][1]
        assert builder.distance_to_paths((gps.lon, gps.lat), route["paths"]) <= 120


def test_bad_waypoint_does_not_discard_neighboring_road_sections(monkeypatch):
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "build_official_road_routes", root / "scripts/build-official-road-routes.py"
    )
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    points = [(37.6 + i * .001, 55.7) for i in range(5)]
    bad = points[2]
    monkeypatch.setattr(builder, "request_road", lambda piece: None if bad in piece else piece)
    assert list(builder.route_pieces([points])) == [points[:2], points[3:]]
    # A two-point tail is still a road section, not an omitted final leg.
    assert list(builder.route_pieces([points[:2]])) == [points[:2]]


def test_context_bus_on_third_ring_has_its_own_road_line():
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "build_official_road_routes", root / "scripts/build-official-road-routes.py"
    )
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    reference = json.loads((root / "public/data/official-road-routes.json").read_text())
    road = next(route for route in reference["routes"] if route["routeId"] == "duty-131542")
    assert builder.distance_to_paths((37.576397, 55.714535), road["paths"]) < 30
