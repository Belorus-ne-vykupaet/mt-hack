"""The warning clock does not change the ML target or read future outcomes."""

from datetime import datetime

import pytest

from transit_ml.warnings import LATENESS_THRESHOLD_SEC, warning_timing


NOW = 1_800_000_000.0


@pytest.mark.parametrize(
    ("horizon", "eligible"),
    [(599.9, False), (600, False), (600.1, True), (720, True),
     (780, True), (780.1, False), (900, False), (900.1, False)],
)
def test_first_warning_requires_both_clock_windows(horizon, eligible):
    timing = warning_timing(NOW + horizon, NOW)
    assert (timing is not None) == eligible
    if timing:
        assert 600 < timing["forecast_horizon_sec"] <= 900
        assert 600 < timing["event_lead_time_sec"] <= 900
        assert timing["event_lead_time_sec"] == pytest.approx(horizon + 120)


def test_warning_is_deferred_without_fabricating_an_earlier_first_issue():
    plan = NOW + 900
    assert warning_timing(plan, NOW) is None
    first = warning_timing(plan, NOW + 120)
    assert first is not None
    assert datetime.fromisoformat(first["issued_at"]).timestamp() == NOW + 120
    assert first["forecast_horizon_sec"] == 780
    assert first["event_lead_time_sec"] == 900


def test_first_issue_and_event_clock_are_immutable_on_recalculation():
    plan = NOW + 780
    first = warning_timing(plan, NOW)
    later = warning_timing(plan, NOW + 150, first_issued_at=NOW)
    assert first is not None and later is not None
    for key in ("issued_at", "target_time", "event_time", "lead_time_sec",
                "forecast_horizon_sec", "event_lead_time_sec"):
        assert later[key] == first[key]
    assert later["current_forecast_horizon_sec"] == 630
    assert later["current_event_lead_time_sec"] == 750


def test_unknown_actual_outcome_does_not_change_publication_clock():
    # Same live inputs permit a warning whether the eventual arrival is early,
    # on time, slightly late or very late. Only the audit reads these outcomes.
    plan = NOW + 720
    outputs = []
    for eventual_arrival in (plan - 30, plan, plan + 120, plan + 900):
        outputs.append(warning_timing(plan, NOW))
        assert eventual_arrival > NOW
    assert all(timing == outputs[0] for timing in outputs)
    assert outputs[0]["event_type"] == "late_threshold"
    assert datetime.fromisoformat(outputs[0]["event_time"]).timestamp() == (
        plan + LATENESS_THRESHOLD_SEC
    )


@pytest.mark.parametrize("first_issue", [NOW + 1, NOW - 121])
def test_invalid_existing_first_issue_is_never_rewritten(first_issue):
    assert warning_timing(NOW + 780, NOW, first_issue) is None


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
def test_nonfinite_timestamps_do_not_emit_warning(value):
    assert warning_timing(value, NOW) is None
    assert warning_timing(NOW + 720, value) is None
    assert warning_timing(NOW + 720, NOW, value) is None


def test_backend_keeps_full_forecast_window_and_publishes_causal_warning(tmp_path, monkeypatch):
    """A real replay Engine defers only the alert and never reads future truth."""
    import asyncio
    import json

    import httpx
    import pandas as pd

    from transit_ml.backend import Engine

    def iso(timestamp):
        return pd.Timestamp(timestamp, unit="s", tz="UTC").isoformat()

    folder = tmp_path / "test"
    folder.mkdir()
    plan = NOW + 900
    pd.DataFrame([{
        "tr_id": 1, "tt_action_item_id": 101,
        "time_begin": iso(plan), "time_fact_begin": iso(plan + 240),
        "geom": "POINT (37.63 55.76)", "building_address": "Целевая остановка",
    }]).to_csv(folder / "schedule.csv", index=False)
    pd.DataFrame([{
        "tr_id": 1, "unit_id": 123, "event_time": iso(NOW + offset),
        "location_valid": True, "lon": 37.61, "lat": 55.75,
        "speed": 10, "heading": 90,
    } for offset in (0, 120, 180, 300)]).to_csv(folder / "traffic.csv", index=False)
    monkeypatch.setenv("TELEMETRY_MODE", "replay")
    monkeypatch.setenv("OFFICIAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("REPLAY_SPEED", "0")
    requests = []

    def predict(request):
        body = json.loads(request.content)
        requests.append(body)
        return httpx.Response(200, json={
            "asOf": body["asOf"], "latencyMs": 1,
            "predictions": [{"vehicleId": item["vehicleId"], "delaySec": 200,
                             "lateProbability": 0.8} for item in body["items"]],
        })

    async def run():
        engine = Engine()

        async def snapshot(offset):
            engine.start = NOW + offset
            engine.cache_at = 0
            return await engine.snapshot()

        async with httpx.AsyncClient(transport=httpx.MockTransport(predict)) as client:
            engine.client = client
            initial = await snapshot(0)
            assert initial["vehicles"][0]["forecast_status"] == "ready"
            assert initial["vehicles"][0]["forecast_horizon_sec"] == 900
            assert initial["vehicles"][0]["risk_probability"] == 0.8
            assert initial["alerts"] == [] and len(engine.warning_audit) == 0

            first = (await snapshot(120))["alerts"][0]
            assert first["forecast_horizon_sec"] == 780
            assert first["event_lead_time_sec"] == 900
            repeated = (await snapshot(180))["alerts"][0]
            assert repeated["created_at"] == first["created_at"]
            assert repeated["event_lead_time_sec"] == 900
            assert repeated["current_forecast_horizon_sec"] == 720
            assert repeated["current_event_lead_time_sec"] == 840
            prior_request = requests[-1]

            # Replace future late truth with an early arrival, still unseen at T.
            engine.actual[1].loc[:, "actual_ts"] = plan - 60
            changed_truth = (await snapshot(180))["alerts"][0]
            assert changed_truth == repeated
            assert requests[-1] == prior_request
            assert len(engine.warning_audit) == 1

            expired = await snapshot(300)
            assert expired["vehicles"][0]["forecast_status"] == "no_target"
            assert expired["alerts"] == [] and len(engine.warning_audit) == 1

    asyncio.run(run())
