from pathlib import Path

import pandas as pd
import pytest

from transit_ml.evaluation import ForecastJournal
from mt_hack.features import build_features, load_split


def prediction(vehicle="vehicle-1", target="101", issued=1000, predicted=150):
    return dict(vehicle_id=vehicle, target_id=target, stop_name="Цель", issued_at=issued,
                planned_at=issued + 720, predicted=predicted, model="test-model")


def test_first_prediction_survives_restart_and_is_not_replaced(tmp_path):
    path = tmp_path / "journal.sqlite3"
    journal = ForecastJournal("plan-a", path)
    journal.issue([prediction()])
    journal.close()
    journal = ForecastJournal("plan-a", path)
    journal.issue([prediction(issued=1030, predicted=999)])
    row = journal.report(1100)["items"][0]
    assert row["predictedDelaySec"] == 150
    assert row["horizonSec"] == 720
    assert journal.report(999)["items"] == []
    journal.close()


def test_observations_remain_unknown_until_seen_and_rewind_hides_them():
    journal = ForecastJournal("plan")
    journal.issue([prediction()])
    journal.observe({("vehicle-1", "101"): 1820}, 1800, "schedule_actual")
    report = journal.report(1800)
    assert report["summary"]["maeSec"] is None
    assert report["summary"]["awaitingObservation"] == 1
    journal.observe({("vehicle-1", "101"): 1820}, 1830, "ndtp_ordered_stop_visit")
    row = journal.report(1830)["items"][0]
    assert row["actualDelaySec"] == 100
    assert row["absoluteErrorSec"] == 50
    assert journal.report(1830)["summary"]["maeSec"] == 50
    assert journal.report(1825)["items"][0]["actualDelaySec"] is None
    journal.observe({("vehicle-1", "101"): 1999}, 2000, "ndtp_ordered_stop_visit")
    assert journal.report(2000)["items"][0]["actualDelaySec"] == 100


def test_route_filter_scope_and_bounded_storage(tmp_path):
    path = tmp_path / "journal.sqlite3"
    journal = ForecastJournal("plan-a", path, limit=3)
    journal.issue([prediction(target=str(i), issued=1000+i) for i in range(5)])
    assert journal.report(1100)["summary"]["total"] == 3
    journal.issue([prediction(vehicle="vehicle-2", issued=1010)])
    assert journal.report(1100, ["duty-2"])["summary"]["total"] == 1
    assert journal.report(1100, ["duty-' OR 1=1 --"])["items"] == []
    journal.close()
    other = ForecastJournal("plan-b", path, limit=3)
    assert other.report(1100)["items"] == []
    other.close()


@pytest.mark.parametrize("value", [float("nan"), float("inf")])
def test_nonfinite_predictions_are_not_scored(value):
    journal = ForecastJournal("plan")
    journal.issue([prediction(predicted=value)])
    assert journal.report(1100)["summary"]["total"] == 0


def test_tree_fast_path_preserves_all_numeric_model_inputs():
    points, traffic, plan = load_split(Path("ml/data/official"), "test")
    points = points.iloc[[0, 10, 100, 200, 352]]
    normal, _ = build_features(points, traffic, plan)
    fast, _ = build_features(points, traffic, plan, include_sequence=False)
    pd.testing.assert_frame_equal(fast, normal, check_exact=True)
