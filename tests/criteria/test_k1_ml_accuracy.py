"""Criterion 1 — ML accuracy (0–6, hidden MAE score of the Data Science section).

The platform score itself cannot be recomputed here. The tests check what can
be checked: the submitted file, that the committed model reproduces it, that
the deployed ML service returns the same numbers, and local error estimates
that are honest about which data took part in model selection.
"""

import hashlib
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd

from criteria_helpers import DATA, ROOT, needs_data, record

SUBMISSION = ROOT / "submission" / "best-6-of-6.csv"
CLAIMED_SHA256 = "0c5d798e40b5d8a4257b9834d7588799e22df59f443622f37ffcd65e29367781"
MODEL = ROOT / "ml" / "artifacts" / "sasha"


def read_submission():
    return pd.read_csv(SUBMISSION, sep=";", dtype={"sample_id": str})


def mae(y, p):
    return float(np.mean(np.abs(np.asarray(y, float) - np.asarray(p, float))))


def test_k1_1_submission_file_is_well_formed():
    raw = SUBMISSION.read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf"), "BOM before the header"
    # Git on Windows (core.autocrlf) turns LF into CRLF in the working copy;
    # the committed content is what was uploaded.
    committed = raw.replace(b"\r\n", b"\n")
    assert hashlib.sha256(committed).hexdigest() == CLAIMED_SHA256
    record("k1.submission_crlf_in_this_checkout", b"\r\n" in raw)
    assert raw.decode("utf-8").splitlines()[0] == "sample_id;prediction"
    sub = read_submission()
    assert list(sub.columns) == ["sample_id", "prediction"]
    assert len(sub) == 151 and sub.sample_id.is_unique
    # sample_id = <tr_id>_<T as epoch seconds>
    assert sub.sample_id.str.fullmatch(r"\d+_\d{10}").all()
    values = sub.prediction.astype(float).to_numpy()
    assert np.isfinite(values).all()
    assert np.abs(values).max() < 3600, "an hour-scale delay suggests a unit error"
    record("k1.submission", {
        "rows": int(len(sub)),
        "vehicles": int(sub.sample_id.str.split("_").str[0].nunique()),
        "min_s": round(float(values.min()), 2),
        "median_s": round(float(np.median(values)), 2),
        "max_s": round(float(values.max()), 2),
        "negative_share": round(float((values < 0).mean()), 3),
    })


def test_k1_1_feature_code_never_reads_actual_arrivals_or_labels():
    for path in (ROOT / "src/mt_hack/features.py", ROOT / "ml/transit_ml/features.py"):
        code = path.read_text(encoding="utf-8")
        for column in ("time_fact_begin", "target_delay_s"):
            assert column not in code, f"{path.name} mentions {column}"


@needs_data
def test_k1_1_submission_matches_the_official_template_and_points():
    template = pd.read_csv(DATA / "sample_submission.csv", sep=";", dtype={"sample_id": str})
    points = pd.read_csv(DATA / "validate" / "points.csv", dtype={"sample_id": str})
    sub = read_submission()
    assert sub.sample_id.tolist() == template.sample_id.tolist(), "order or IDs differ"
    assert set(points.sample_id) == set(sub.sample_id)
    # The encoded T must agree with the point itself.
    from mt_hack.features import seconds

    joined = sub.merge(points, on="sample_id", validate="one_to_one")
    encoded = joined.sample_id.str.split("_").str[1].astype(int).to_numpy()
    assert (encoded == seconds(joined["T"]).astype(int)).all()


@needs_data
def test_k1_2_committed_model_reproduces_the_submitted_numbers():
    from mt_hack.features import build_features, load_split
    from mt_hack.runtime import SelectedDelayModel

    points, traffic, plan = load_split(DATA, "validate")
    x, _ = build_features(points, traffic, plan)
    model = SelectedDelayModel(MODEL)
    regenerated = pd.DataFrame(
        {"sample_id": points.sample_id.astype(str), "model": model.predict(x)}
    )
    merged = read_submission().merge(regenerated, on="sample_id", validate="one_to_one")
    diff = (merged.prediction - merged.model).abs()
    record("k1.reproduction", {
        "rows": int(len(merged)),
        "max_abs_diff_s": float(diff.max()),
        "model_components": sorted(k for k, w in model.bundle["weights"].items() if w > 0),
    })
    assert len(merged) == 151
    assert diff.max() < 1e-6, "the committed model does not reproduce the submitted file"


@needs_data
def test_k1_3_deployed_ml_service_returns_the_submitted_numbers():
    """The Docker ML endpoint /predict/raw computes the very numbers that were submitted."""
    from fastapi.testclient import TestClient
    from transit_ml.features import Dataset
    from transit_ml.inference import app

    points = pd.read_csv(DATA / "validate" / "points.csv", dtype={"sample_id": str})
    traffic = pd.read_csv(DATA / "validate" / "traffic.csv", low_memory=False)
    plan = pd.read_csv(DATA / "validate" / "schedule_plan.csv")
    from mt_hack.features import seconds

    traffic["_t"] = seconds(traffic.event_time)  # pandas 3 keeps microseconds: no manual int64
    dataset = Dataset(DATA / "validate")
    submitted = read_submission().set_index("sample_id").prediction

    def number(value):
        value = float(value) if value is not None and not pd.isna(value) else None
        return value if value is None or math.isfinite(value) else None

    diffs = []
    with TestClient(app) as client:
        for row in points.itertuples():
            t = pd.Timestamp(row.T, tz="UTC").timestamp()
            own = traffic[(traffic.tr_id == row.tr_id) & (traffic._t > t - 1800) & (traffic._t <= t)]
            schedule = plan[plan.tr_id == row.tr_id]
            stop = schedule[schedule.tt_action_item_id == row.target_stop_id]
            assert len(stop) == 1, f"target of {row.sample_id} is not in the validate plan"
            point = {
                "sample_id": row.sample_id, "tr_id": int(row.tr_id), "T": str(row.T),
                "target_stop_id": int(row.target_stop_id),
                # The service matches the target by the plan's own time string.
                "target_time_begin": str(stop.time_begin.iloc[0]),
                "cur_dev_s": number(row.cur_dev_s),
            }
            features = dataset.feature({**point, "cur_dev_s": point["cur_dev_s"] if point["cur_dev_s"] is not None else float("nan")})
            item = {
                "vehicleId": row.sample_id,
                "point": point,
                "telemetry": [
                    {
                        "tr_id": int(r.tr_id), "event_time": str(r.event_time),
                        "location_valid": str(r.location_valid).lower() == "true",
                        "lon": number(r.lon), "lat": number(r.lat),
                        "speed": number(r.speed), "heading": number(r.heading),
                    }
                    for r in own.itertuples()
                ],
                "schedule": [
                    {"tt_action_item_id": int(s.tt_action_item_id), "tr_id": int(s.tr_id),
                     "time_begin": str(s.time_begin), "geom": str(s.geom)}
                    for s in schedule.itertuples()
                ],
                "features": {k: number(v) for k, v in features.items()},
            }
            response = client.post("/predict/raw", json={"asOf": point["T"], "items": [item]})
            assert response.status_code == 200, response.text
            served = response.json()["predictions"][0]["delaySec"]
            diffs.append(abs(served - submitted[row.sample_id]))
    record("k1.service_vs_submission_max_abs_diff_s", float(max(diffs)))
    assert len(diffs) == 151 and max(diffs) < 1e-6


@needs_data
def test_k1_4_provided_test_mae_beats_baselines_and_matches_documentation():
    from mt_hack.features import build_features, load_split
    from mt_hack.runtime import SelectedDelayModel

    points, traffic, plan = load_split(DATA, "test")
    x, _ = build_features(points, traffic, plan)
    y = points.target_delay_s.to_numpy(float)
    prediction = SelectedDelayModel(MODEL).predict(x)
    current = points.cur_dev_s.fillna(0).to_numpy(float)
    scores = {
        "model": mae(y, prediction),
        "persistence": mae(y, current),
        "zero": mae(y, np.zeros_like(y)),
    }
    horizon = pd.to_datetime(points.target_time_begin, utc=True) - pd.to_datetime(points["T"], utc=True)
    minutes = horizon.dt.total_seconds() / 60
    by_horizon = {
        f"{lo}-{hi}min": round(mae(y[(minutes > lo) & (minutes <= hi)], prediction[(minutes > lo) & (minutes <= hi)]), 2)
        for lo, hi in ((10, 12), (12, 13.5), (13.5, 15))
    }
    rng = np.random.default_rng(2026)
    vehicles = points.tr_id.unique()
    boot = []
    for _ in range(1000):
        chosen = rng.choice(vehicles, len(vehicles), replace=True)
        idx = np.concatenate([np.flatnonzero(points.tr_id.to_numpy() == v) for v in chosen])
        boot.append(mae(y[idx], prediction[idx]))
    record("k1.provided_test", {
        **{k: round(v, 3) for k, v in scores.items()},
        "n": int(len(y)),
        "model_mae_vehicle_bootstrap_95": [round(float(q), 2) for q in np.quantile(boot, [0.025, 0.975])],
        "mae_by_horizon": by_horizon,
        "note": "provided test was used to choose ExtraTrees among trained candidates",
    })
    assert scores["model"] < scores["persistence"] < scores["zero"]
    assert abs(scores["model"] - 58.0875) < 0.01, "documented MAE does not match the model"


@needs_data
def test_k1_5_chronological_holdout_on_train_is_better_than_baselines():
    """Refit the chosen ExtraTrees configuration on early train, score late real vehicles."""
    import joblib
    from sklearn.base import clone
    from mt_hack.features import build_features, load_split, seconds

    points, traffic, plan = load_split(DATA, "train")
    x, _ = build_features(points, traffic, plan)
    y = points.target_delay_s.to_numpy(float)
    t = seconds(points["T"])
    known = seconds(points.target_time_begin) + y
    cutoff = pd.Timestamp("2026-01-06 16:00:00").timestamp()
    audit_start = pd.Timestamp("2026-01-06 20:00:00").timestamp()
    real = points.tr_id.to_numpy() < 9_000_000
    train = (known < cutoff - 1800) & (t < cutoff - 1800)
    audit = (t >= audit_start) & real
    weights = np.where(real, 1.0, 0.25)
    model = clone(joblib.load(MODEL / "ensemble.joblib")["extra_trees"])
    model.fit(x[train], y[train], extratreesregressor__sample_weight=weights[train])
    prediction = model.predict(x[audit])
    scores = {
        "model": mae(y[audit], prediction),
        "persistence": mae(y[audit], x.cur_dev_s.fillna(0).to_numpy()[audit]),
        "zero": mae(y[audit], np.zeros(audit.sum())),
    }
    test_points = pd.read_csv(DATA / "labels" / "labels_test.csv")
    same_day = pd.to_datetime(test_points["T"]).dt.date.isin(pd.to_datetime(points["T"]).dt.date.unique())
    record("k1.chronological_holdout", {
        **{k: round(v, 3) for k, v in scores.items()},
        "train_rows": int(train.sum()), "audit_rows": int(audit.sum()),
        "synthetic_train_share": round(float((~real).mean()), 3),
        "test_points_on_train_days_share": round(float(same_day.mean()), 3),
    })
    assert scores["model"] < min(scores["persistence"], scores["zero"])


@needs_data
def test_k1_6_real_points_ignore_future_telemetry_actuals_and_labels():
    from mt_hack.features import build_features, load_split, seconds

    points, traffic, plan = load_split(DATA, "test")
    full_plan = pd.read_csv(DATA / "test" / "schedule.csv")  # includes time_fact_begin
    sample = points.sample(25, random_state=2026)
    event = seconds(traffic.event_time)
    changed = []
    for row in sample.to_dict("records"):
        point = pd.DataFrame([row])
        t = seconds(point["T"])[0]
        base, base_seq = build_features(point, traffic, plan)
        past = traffic[(traffic.tr_id != row["tr_id"]) | (event <= t)]
        poisoned = traffic.copy()
        future = (poisoned.tr_id == row["tr_id"]) & (event > t)
        poisoned.loc[future, ["speed", "lon", "lat"]] = [150.0, 0.0, 0.0]
        for variant, variant_plan in ((past, plan), (poisoned, full_plan)):
            other, other_seq = build_features(point, variant, variant_plan)
            same = other.equals(base) and np.array_equal(other_seq, base_seq)
            if not same:
                changed.append(row["sample_id"])
    record("k1.leakage_points_checked", int(len(sample)))
    assert not changed, f"future data changed features for {changed}"
