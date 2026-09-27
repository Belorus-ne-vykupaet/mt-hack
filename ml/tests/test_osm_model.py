"""Regression checks for Olya's deployed historical-OSM model."""
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from mt_hack.external_features import OSMCellFeatures, get_osm_store
from mt_hack.features import load_split, build_features, PLAN_COLUMNS, TRAFFIC_COLUMNS
from mt_hack.runtime import SelectedDelayModel
from transit_ml.features import FEATURES
from transit_ml.inference import app


def test_exact_olya_artifact_schema_and_reproduced_test_mae():
    report = json.loads(Path("reports/olya-ml-integration-2026-09-27.json").read_text())
    assert hashlib.sha256(Path("ml/artifacts/sasha/ensemble.joblib").read_bytes()).hexdigest() == report["artifactSha256"]
    points, traffic, plan = load_split("ml/data/official", "test")
    x, _ = build_features(points, traffic, plan, include_sequence=False)
    model = SelectedDelayModel("ml/artifacts/sasha")
    assert list(x) == model.feature_names and len(x.columns) == 64
    assert len([name for name in x if "osm_" in name]) == 14
    prediction = model.predict(x)
    assert np.abs(prediction - points.target_delay_s).mean() == pytest.approx(52.19818696883853)
    osm = json.loads(Path("ml/data/external/osm_cells.json").read_text())
    assert osm["historical"] is True
    assert pd.Timestamp(osm["snapshot_date"]) < pd.Timestamp(osm["earliest_prediction_t"])


def test_osm_missing_coordinates_remain_unknown():
    store = OSMCellFeatures()
    assert store.available
    assert all(np.isnan(value) for value in store.features(np.nan, np.nan).values())
    assert store.raw(-179, -89) == {}


def test_raw_http_predictions_use_olya_model_and_its_64_features():
    points, traffic, plan = load_split("ml/data/official", "test")
    point = points.iloc[0]
    own = traffic[traffic.tr_id == point.tr_id]
    schedule = plan[plan.tr_id == point.tr_id]
    x, _ = build_features(points.iloc[:1], own, schedule, include_sequence=False)
    expected = SelectedDelayModel("ml/artifacts/sasha").predict(x)[0]
    fields = ["sample_id", "tr_id", "T", "target_stop_id", "target_time_begin", "cur_dev_s"]
    features = dict.fromkeys(FEATURES, None)
    features.update(cur_dev_s=float(point.cur_dev_s), horizon_s=float(x.horizon_s.iloc[0]))
    # JSON conversion normalizes numpy scalar types and NaN to JSON-compatible values.
    body = {"asOf": point["T"], "items": [{
        "vehicleId": "test", "point": json.loads(points.iloc[:1][fields].to_json(orient="records"))[0],
        "telemetry": json.loads(own[TRAFFIC_COLUMNS].to_json(orient="records")),
        "schedule": json.loads(schedule[PLAN_COLUMNS].to_json(orient="records")), "features": features,
    }]}
    with TestClient(app) as client:
        health = client.get("/health").json()
        assert health["modelVersion"] == "olya-extra-trees-osm-v1"
        assert health["metrics"]["externalFeatureSources"] == ["OpenStreetMap"]
        response = client.post("/predict/raw", json=body)
        assert response.status_code == 200, response.text
        assert response.json()["predictions"][0]["delaySec"] == pytest.approx(expected)


def test_model_fails_startup_if_required_osm_dataset_is_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("MT_HACK_OSM_FEATURES", str(tmp_path / "missing.json"))
    get_osm_store.cache_clear()
    try:
        with pytest.raises(RuntimeError, match="historical road dataset"):
            with TestClient(app):
                pass
    finally:
        get_osm_store.cache_clear()
