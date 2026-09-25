import numpy as np
import pandas as pd
import pytest
from transit_ml.features import Dataset, seconds


@pytest.fixture
def dataset(tmp_path):
    pd.DataFrame(
        [
            {
                "tr_id": 1,
                "event_time": "2026-01-06 12:00:00",
                "speed": 10,
                "location_valid": True,
                "lon": 37.5,
                "lat": 55.7,
                "heading": 10,
            },
            {
                "tr_id": 1,
                "event_time": "2026-01-06 12:01:00",
                "speed": 100,
                "location_valid": True,
                "lon": 38.0,
                "lat": 56.0,
                "heading": 90,
            },
        ]
    ).to_csv(tmp_path / "traffic.csv", index=False)
    pd.DataFrame(
        [
            {
                "tt_action_item_id": 101,
                "tr_id": 1,
                "time_begin": "2026-01-06 12:12:00",
                "time_fact_begin": "2099-01-01",
                "geom": "POINT (37.51 55.71)",
                "building_address": "Stop",
            }
        ]
    ).to_csv(tmp_path / "schedule.csv", index=False)
    return Dataset(tmp_path)


def point(**kw):
    return {
        "tr_id": 1,
        "T": "2026-01-06 12:00:00",
        "target_stop_id": 101,
        "target_time_begin": "2026-01-06 12:12:00",
        "cur_dev_s": 60,
        **kw,
    }


def test_future_telemetry_cannot_change_features(dataset):
    first = dataset.feature(point())
    dataset.groups[1].loc[1, ["speed", "lat", "lon"]] = [0, 80, 100]
    assert first == dataset.feature(point())
    assert first["speed_last"] == 10 and first["horizon_s"] == 720
    assert "time_fact_begin" not in dataset.schedule.columns


def test_future_injected_history_is_also_excluded(dataset):
    assert dataset.feature(point(), dataset.groups[1]) == dataset.feature(point())


def test_strict_horizon_and_target_identity(dataset):
    with pytest.raises(ValueError):
        dataset.feature(point(T="2026-01-06 12:02:00"))
    with pytest.raises(ValueError):
        dataset.feature(point(T="2026-01-06 11:56:59"))
    with pytest.raises(ValueError):
        dataset.feature(point(tr_id=2))
    with pytest.raises(ValueError):
        dataset.feature(point(target_time_begin="2026-01-06 12:13:00"))


def test_missing_timestamp_stays_missing():
    s = seconds(pd.Series(["2026-01-06 12:00:00", None]))
    assert s[0] > 1_700_000_000 and np.isnan(s[1])


def test_missing_gps_and_speed_are_not_fabricated(dataset):
    dataset.groups[1].loc[0, "location_valid"] = False
    dataset.groups[1].loc[0, "speed"] = 368
    features = dataset.feature(point())
    assert np.isnan(features["distance_target_m"]) and np.isnan(features["speed_last"])
    assert features["gps_age_s"] == 1800
