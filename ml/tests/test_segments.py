"""Contract examples for honest, causal stop-to-stop metrics."""

import pandas as pd
import pytest

from transit_ml.segments import SegmentMatcher, match_segment


def plan(points=None):
    points = points or [(100, 37.0), (200, 37.004), (300, 37.008)]
    return pd.DataFrame([
        {"ts": ts, "lon": lon, "lat": 55.0, "tr_id": 7,
         "tt_action_item_id": i + 1, "building_address": f"Stop {i + 1}"}
        for i, (ts, lon) in enumerate(points)
    ])


def history(rows):
    return pd.DataFrame([
        {"ts": ts, "lon": lon, "lat": 55.0, "speed": speed,
         "location_valid": True} for ts, lon, speed in rows
    ])


def test_progression_observes_speed_dwell_and_next_segment():
    h = history([(110, 37.0, 0), (130, 37.0, 0), (150, 37.001, 20),
                 (170, 37.003, 20), (210, 37.004, 0), (230, 37.005, 20)])
    result = match_segment(plan(), h, 230)
    assert result["status"] == "matched"
    first, second = result["segments"]
    assert first["complete"] and not first["is_current"]
    assert first["from_stop_id"] == "1" and first["to_stop_id"] == "2"
    assert first["mean_speed_kmh"] == 10
    assert first["dwell_sec"] == 20
    assert first["coverage_sec"] == 100
    assert first["current_delay_sec"] == 10
    assert second["is_current"] and second["from_stop_id"] == "2"
    assert result["current_segment_id"] == second["id"]
    assert result["current_delay_sec"] == 10
    assert second["geometry"]["coordinates"] == [[37.004, 55.0], [37.005, 55.0]]
    assert second["progress"] is None
    assert "predicted_delay_sec" not in second


def test_missing_stop_names_use_visit_ids_instead_of_nan():
    p = plan()
    p.loc[0, "building_address"] = float("nan")
    p.loc[1, "building_address"] = " "
    result = match_segment(p, history([(110, 37.0, 0), (130, 37.001, 20)]), 130)
    assert result["current_segment"]["name"] == "Остановка 1 → Остановка 2"


def test_future_packets_and_actual_outcomes_cannot_change_result():
    p = plan()
    h = history([(110, 37.0, 0), (150, 37.001, 20), (170, 37.003, 20)])
    expected = match_segment(p, h, 170)
    h = pd.concat([h, history([(171, 37.008, 0), (200, 37.004, 0)])])
    p["time_fact_begin"] = ["2099-01-01", "1900-01-01", "2030-01-01"]
    assert match_segment(p, h, 170) == expected


def test_nearby_stops_are_not_consumed_during_one_stationary_visit():
    p = plan([(100, 37.0), (130, 37.0006), (200, 37.004)])
    stationary = history([(100, 37.0, 0), (120, 37.0, 0), (140, 37.0, 0)])
    result = match_segment(p, stationary, 140)
    assert result["observed_stop_ids"] == ["1"]
    moving = history([(100, 37.0, 0), (120, 37.0003, 10), (140, 37.0006, 0)])
    result = match_segment(p, moving, 140)
    assert result["observed_stop_ids"] == ["1", "2"]
    assert result["current_segment"]["from_stop_id"] == "2"


def test_loop_repeated_location_requires_departure_and_preserves_visit_order():
    p = plan([(100, 37.0), (200, 37.004), (300, 37.0), (400, 37.008)])
    h = history([(100, 37.0, 0), (150, 37.002, 20), (200, 37.004, 0),
                 (250, 37.002, 20), (300, 37.0, 0), (330, 37.002, 20)])
    result = match_segment(p, h, 330)
    assert result["observed_stop_ids"] == ["1", "2", "3"]
    assert result["current_segment"]["from_stop_id"] == "3"


def test_ambiguous_colocated_initial_visits_are_not_guessed():
    result = match_segment(plan([(100, 37.0), (120, 37.0), (200, 37.004)]),
                           history([(110, 37.0, 0)]), 110)
    assert result["status"] == "unavailable"
    assert result["segments"] == []


@pytest.mark.parametrize("kind,reason", [("empty", "missing_gps"),
    ("invalid", "missing_gps"), ("out_of_range", "missing_gps"),
    ("stale", "stale_gps"), ("future", "missing_gps")])
def test_missing_invalid_stale_and_future_gps_remain_unavailable(kind, reason):
    h = history([(100, 37.0, 0)])
    cutoff = 100
    if kind == "empty":
        h = h.iloc[:0]
    elif kind == "invalid":
        h["location_valid"] = False
    elif kind == "out_of_range":
        h["lat"] = 95
    elif kind == "stale":
        cutoff = 281
    elif kind == "future":
        cutoff = 99
    result = match_segment(plan(), h, cutoff)
    assert result["status"] == "unavailable" and result["reason"] == reason
    assert result["current_delay_sec"] is None and result["segments"] == []


def test_gap_does_not_imply_bus_stayed_on_previous_segment():
    h = history([(100, 37.0, 0), (120, 37.001, 20), (260, 37.006, 20)])
    result = match_segment(plan(), h, 260)
    assert result["status"] == "unavailable"
    assert result["current_segment_id"] is None
    assert result["segments"][0]["geometry"]["coordinates"] == [[37.0, 55.0], [37.001, 55.0]]
    assert not result["segments"][0]["is_current"]


def test_single_stop_sample_has_no_fabricated_zero_speed_or_street_shape():
    result = match_segment(plan(), history([(100, 37.0, 0)]), 100)
    segment = result["current_segment"]
    assert segment["geometry"]["coordinates"] == []
    assert segment["mean_speed_kmh"] is None and segment["dwell_sec"] is None
    assert segment["observed_distance_m"] is None


def test_invalid_scheduled_stop_is_not_skipped_to_invent_a_segment():
    p = plan()
    p.loc[1, "lat"] = 95
    result = match_segment(p, history([(100, 37.0, 0), (150, 37.001, 10)]), 150)
    assert result["current_segment"]["to_stop_id"] == "2"
    assert result["current_segment"]["geometry"]["coordinates"][-1] == [37.001, 55.0]


def test_last_stop_is_terminal_not_a_fictional_outgoing_segment():
    result = match_segment(plan(), history([(300, 37.008, 0)]), 300)
    assert result["status"] == "terminal"
    assert result["current_delay_sec"] == 0
    assert result["segments"] == []


def test_out_of_order_packets_sort_causally():
    h = history([(100, 37.0, 0), (120, 37.001, 10), (160, 37.002, 20)])
    matcher = SegmentMatcher(plan())
    assert matcher.match(h, 160) == matcher.match(h.iloc[::-1], 160)


def test_speed_jitter_cannot_consume_later_visit_to_same_location():
    p = plan([(100, 37.0), (200, 37.0), (300, 37.004)])
    h = history([(100, 37.0, 0), (130, 37.00001, 4), (200, 37.0, 0)])
    result = match_segment(p, h, 200)
    assert result["observed_stop_ids"] == ["1"]
    assert result["current_segment"]["from_stop_id"] == "1"


def test_gap_reacquisition_keeps_unique_ids_and_first_observed_arrival():
    h = history([(100, 37.0, 0), (110, 37.0, 0), (240, 37.0, 0)])
    result = match_segment(plan(), h, 240)
    assert result["status"] == "matched"
    assert len(result["segments"]) == 1
    assert result["current_delay_sec"] == 0
    assert result["current_segment"]["mean_speed_kmh"] is None
    assert "_rows" not in result["current_segment"]


def test_missing_intermediate_visit_does_not_mislabel_multiple_segments():
    p = plan([(100, 37.0), (150, 37.004), (200, 37.008), (300, 37.012)])
    h = history([(100, 37.0, 0), (140, 37.003, 20),
                 (170, 37.006, 20), (200, 37.008, 0)])
    result = match_segment(p, h, 200)
    assert result["observed_stop_ids"] == ["1", "3"]
    assert len(result["segments"]) == 1
    assert result["segments"][0]["from_stop_id"] == "3"


def test_early_immediate_successor_requires_observed_departure():
    p = plan([(100, 37.0), (900, 37.004), (1100, 37.008)])
    h = history([(110, 37.0, 0), (130, 37.002, 20), (210, 37.004, 0)])
    result = match_segment(p, h, 210)
    assert result["observed_stop_ids"] == ["1", "2"]
    assert result["current_delay_sec"] == -690
    assert result["current_segment"]["from_stop_id"] == "2"
    # Same arrival without the earlier visit is insufficient to identify this
    # extremely early scheduled occurrence.
    unanchored = match_segment(p, h.iloc[1:], 210)
    assert "2" not in unanchored["observed_stop_ids"]


def test_colocated_previous_and_future_stops_do_not_suppress_future_target():
    p = plan([(100, 37.0), (1060, 37.0), (1300, 37.008)])
    h = history([(340, 37.004, 20), (370, 37.0, 0)])
    result = match_segment(p, h, 370)
    assert result["observed_stop_ids"] == ["1"]
    assert "2" not in result["observed_stop_ids"]
