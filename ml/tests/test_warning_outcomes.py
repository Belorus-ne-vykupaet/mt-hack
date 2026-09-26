"""Warnings must survive the forecast window and resolve only from observed facts."""

import asyncio
import json
import struct
from collections import deque

import httpx
import pandas as pd
import pytest

from transit_ml.backend import Engine, app, warning_audit
from transit_ml.ndtp import crc16, parse_frame
from transit_ml.outcomes import arrival_outcome, visible_outcome


NOW = pd.Timestamp("2026-01-06T12:00:00Z").timestamp()


@pytest.mark.parametrize("delay,late,risk", [
    (-5, False, "false_positive"), (0, False, "false_positive"),
    (107, True, "false_positive"), (120, True, "false_positive"),
    (120.1, True, "confirmed"), (400, True, "confirmed"),
])
def test_arrival_does_not_redefine_false_risk_alerts_as_success(delay, late, risk):
    outcome = arrival_outcome(planned_at=NOW + 720, issued_at=NOW,
                              arrival_at=NOW + 720 + delay,
                              observed_at=NOW + 1200, cutoff=NOW + 1200,
                              source="schedule_actual")
    assert (outcome["delay_onset_at"] is not None) == late
    assert outcome["warning_in_onset_window"] == (True if late else None)
    assert outcome["lead_to_delay_onset_sec"] == (720 if late else None)
    assert outcome["risk_outcome"] == risk
    assert outcome["lead_to_actual_sec"] == pytest.approx(720 + delay)
    assert outcome["outcome_observed_at"] != outcome["delay_onset_at"]


@pytest.mark.parametrize("arrival,observed,cutoff", [
    (1000, 1000, 999), (1000, 999, 1000), (900, 1000, 999),
])
def test_unavailable_arrivals_cannot_confirm_a_delay(arrival, observed, cutoff):
    assert arrival_outcome(planned_at=NOW + 720, issued_at=NOW,
                           arrival_at=NOW + arrival, observed_at=NOW + observed,
                           cutoff=NOW + cutoff, source="schedule_actual") is None


def test_future_outcomes_remain_hidden_when_replay_clock_is_rewound():
    record = {"target_time": "2026-01-06T12:12:00Z", **arrival_outcome(
        planned_at=NOW + 720, issued_at=NOW, arrival_at=NOW + 960,
        observed_at=NOW + 970, cutoff=NOW + 970, source="schedule_actual",
    )}
    assert visible_outcome(record, NOW) == {"outcome_status": "pending"}
    assert visible_outcome(record, NOW + 900) == {"outcome_status": "awaiting_observation"}
    assert visible_outcome(record, NOW + 970)["risk_outcome"] == "confirmed"


@pytest.fixture
def engine(tmp_path, monkeypatch):
    folder = tmp_path / "test"
    folder.mkdir()
    def iso(offset):
        return pd.Timestamp(NOW + offset, unit="s", tz="UTC").isoformat()
    pd.DataFrame([
        {"tr_id": 1, "tt_action_item_id": 101, "time_begin": iso(-30),
         "time_fact_begin": iso(-30), "geom": "POINT (37.60 55.75)", "building_address": "A"},
        {"tr_id": 1, "tt_action_item_id": 102, "time_begin": iso(720),
         "time_fact_begin": iso(960), "geom": "POINT (37.63 55.76)", "building_address": "B"},
    ]).to_csv(folder / "schedule.csv", index=False)
    pd.DataFrame([
        {"tr_id": 1, "unit_id": 1001, "event_time": iso(offset),
         "location_valid": True, "lon": lon, "lat": lat, "speed": speed, "heading": 90}
        for offset, lon, lat, speed in [
            (-30, 37.60, 55.75, 0), (0, 37.601, 55.75, 12),
            (700, 37.62, 55.76, 12), (900, 37.629, 55.76, 10),
            (960, 37.63, 55.76, 0), (1800, 37.64, 55.77, 10),
        ]
    ]).to_csv(folder / "traffic.csv", index=False)
    monkeypatch.setenv("OFFICIAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TELEMETRY_MODE", "replay")
    monkeypatch.setenv("REPLAY_SPEED", "0")
    monkeypatch.setenv("REPLAY_START", iso(0))
    return Engine()


def test_real_replay_issues_before_any_delay_and_confirms_only_after_arrival(engine, monkeypatch):
    requests = []
    def predict(request):
        body = json.loads(request.content)
        requests.append(body)
        return httpx.Response(200, json={"asOf": body["asOf"], "latencyMs": 1,
            "predictions": [{"vehicleId": i["vehicleId"], "delaySec": 240,
                             "lateProbability": .8} for i in body["items"]]})
    monkeypatch.setattr(app.state, "engine", engine, raising=False)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(predict)) as client:
            engine.client = client
            first = await engine.snapshot()
            assert first["vehicles"][0]["current_delay_sec"] == 0
            assert first["alerts"]
            issued = dict(engine.warning_audit[0])
            assert issued["current_delay_sec_at_issue"] == 0
            pending = (await warning_audit())["items"][0]
            assert pending["outcome_status"] == "pending"
            assert "actual_arrival_at" not in pending

            # Same issue-time observations with a different, still future truth.
            original_request = requests[-1]
            engine.actual[1].loc[engine.actual[1].tt_action_item_id.eq(102), "actual_ts"] = NOW + 719
            engine.cache_at = 0
            assert (await engine.snapshot())["alerts"] == first["alerts"]
            assert requests[-1] == original_request
            assert (await warning_audit())["items"][0] == pending
            engine.actual[1].loc[engine.actual[1].tt_action_item_id.eq(102), "actual_ts"] = NOW + 960

            # ML window is long closed; arrival still cannot be inspected.
            engine.start = NOW + 900
            engine.cache_at = 0
            waiting = (await warning_audit())["items"][0]
            assert waiting["outcome_status"] == "awaiting_observation"
            assert "actual_arrival_at" not in waiting
            assert engine.cache["alerts"] == []
            engine.start = NOW + 960
            engine.cache_at = 0
            confirmed = (await warning_audit())["items"][0]
            assert confirmed["outcome_source"] == "schedule_actual"
            assert confirmed["actual_delay_sec"] == 240
            assert confirmed["lead_to_delay_onset_sec"] == 720
            assert confirmed["lead_to_actual_sec"] == 960
            assert confirmed["warning_in_onset_window"] is True
            assert confirmed["risk_outcome"] == "confirmed"
            for key, value in issued.items():
                assert confirmed[key] == value
    asyncio.run(run())


def test_ndtp_requires_observed_ordered_visit_and_freezes_first_arrival(engine, monkeypatch):
    engine.mode = "ndtp"
    clock = [NOW]
    monkeypatch.setattr("transit_ml.backend.time.time", lambda: clock[0])
    monkeypatch.setattr(app.state, "engine", engine, raising=False)
    def packet(offset, lon, lat=55.75, speed=0):
        navigation = bytes([0, 0]) + struct.pack(
            "<IIIBBHHHHHBB", int(NOW + offset), int(lon * 1e7), int(lat * 1e7),
            224, 100, speed, speed, 90, 100, 150, 8, 1,
        )
        payload = struct.pack("<HHHI", 1, 101, 1, 1) + navigation
        frame = struct.pack("<HHHHBIH", 0x7E7E, len(payload), 0,
                            crc16(payload), 2, 1001, 0) + payload
        return parse_frame(frame)
    engine.receiver.histories[1001] = deque([
        packet(-30, 37.60), packet(0, 37.601, speed=12),
    ], maxlen=1500)
    def predict(request):
        body = json.loads(request.content)
        return httpx.Response(200, json={"asOf": body["asOf"], "latencyMs": 1,
            "predictions": [{"vehicleId": i["vehicleId"], "delaySec": 240,
                             "lateProbability": .8} for i in body["items"]]})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(predict)) as client:
            engine.client = client
            await engine.snapshot()
            assert len(engine.warning_audit) == 1
            clock[0] = NOW + 900
            engine.cache_at = 0
            missing = (await warning_audit())["items"][0]
            assert missing["outcome_status"] == "awaiting_observation"
            assert "delay_onset_at" not in missing
            # NDTP must ignore the future CSV truth even after its timestamp.
            clock[0] = NOW + 970
            engine.cache_at = 0
            assert (await warning_audit())["items"][0]["outcome_status"] == "awaiting_observation"
            engine.receiver.histories[1001].append(packet(970, 37.63, 55.76))
            engine.cache_at = 0
            confirmed = (await warning_audit())["items"][0]
            assert confirmed["outcome_source"] == "ndtp_ordered_stop_visit"
            assert confirmed["actual_delay_sec"] == 250
            assert confirmed["lead_to_delay_onset_sec"] == 720
            clock[0] = NOW + 1000
            engine.receiver.histories[1001].append(packet(1000, 37.63, 55.76))
            engine.cache_at = 0
            assert (await warning_audit())["items"][0] == confirmed
    asyncio.run(run())
