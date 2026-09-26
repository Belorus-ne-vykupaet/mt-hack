"""Independent ML HTTP service. It receives features, never labels or future observations."""

import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import pandas as pd
from catboost import CatBoostClassifier, CatBoostRegressor
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .features import FEATURES
from mt_hack.features import PLAN_COLUMNS, TRAFFIC_COLUMNS, build_features, seconds
from mt_hack.runtime import SelectedDelayModel


class Item(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    vehicleId: str
    features: dict[str, float | None]


class Batch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asOf: str
    items: list[Item] = Field(min_length=1, max_length=2000)


class RawPoint(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    sample_id: str
    tr_id: int
    T: str
    target_stop_id: int
    target_time_begin: str
    cur_dev_s: float | None


class RawTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    tr_id: int
    event_time: str
    location_valid: bool
    lon: float | None
    lat: float | None
    speed: float | None
    heading: float | None


class RawPlanStop(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tt_action_item_id: int
    tr_id: int
    time_begin: str
    geom: str


class RawItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    vehicleId: str
    point: RawPoint
    telemetry: list[RawTelemetry]
    schedule: list[RawPlanStop] = Field(min_length=1)
    features: dict[str, float | None]


class RawBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asOf: str
    items: list[RawItem] = Field(min_length=1, max_length=2000)


@asynccontextmanager
async def lifespan(app):
    root = Path(os.getenv("ML_ARTIFACTS", "ml/artifacts"))
    app.state.reg = CatBoostRegressor()
    app.state.reg.load_model(str(root / "delay.cbm"))
    app.state.clf = CatBoostClassifier()
    app.state.clf.load_model(str(root / "late.cbm"))
    app.state.sasha = SelectedDelayModel(root / "sasha")
    app.state.metrics = json.loads((root / "metrics.json").read_text())
    app.state.requests = 0
    app.state.last_ms = 0
    yield


app = FastAPI(
    title="Transit Hub · causal ML inference", version="2.0", lifespan=lifespan
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "modelVersion": app.state.metrics["modelVersion"],
        "requests": app.state.requests,
        "lastInferenceMs": app.state.last_ms,
        "metrics": app.state.metrics,
    }


@app.post("/predict")
def predict(body: Batch):
    """Signed fact-minus-plan seconds and independent probability of delay >120s."""
    start = time.perf_counter()
    for item in body.items:
        if (
            set(item.features) != set(FEATURES)
            or item.features["horizon_s"] is None
            or not 600 < item.features["horizon_s"] <= 900
        ):
            raise HTTPException(
                422, "Exact feature schema and horizon (600,900] seconds required"
            )
    if len({i.vehicleId for i in body.items}) != len(body.items):
        raise HTTPException(422, "Duplicate vehicle IDs")
    matrix = pd.DataFrame([i.features for i in body.items], columns=FEATURES).astype(
        float
    )
    prediction = app.state.reg.predict(matrix, thread_count=2)
    probability = app.state.clf.predict_proba(matrix, thread_count=2)[:, 1]
    if not np.isfinite(prediction).all():
        raise HTTPException(503, "Non-finite model output")
    app.state.requests += 1
    app.state.last_ms = round((time.perf_counter() - start) * 1000, 2)
    return {
        "asOf": body.asOf,
        "modelVersion": "catboost-official-v1",
        "latencyMs": app.state.last_ms,
        "predictions": [
            {
                "vehicleId": item.vehicleId,
                "delaySec": float(pred),
                "lateProbability": float(prob),
            }
            for item, pred, prob in zip(body.items, prediction, probability)
        ],
    }


@app.post("/predict/raw")
def predict_raw(body: RawBatch):
    """Sasha's selected model on causal telemetry; CatBoost estimates late risk."""
    started = time.perf_counter()
    if len({item.vehicleId for item in body.items}) != len(body.items):
        raise HTTPException(422, "Duplicate vehicle IDs")
    points = []
    telemetry = []
    schedule = []
    for item in body.items:
        point = item.point
        try:
            horizon = seconds(pd.Series([point.T, point.target_time_begin]))
        except (ValueError, TypeError) as error:
            raise HTTPException(422, "Invalid point timestamp") from error
        if point.T != body.asOf or not 600 < horizon[1] - horizon[0] <= 900:
            raise HTTPException(422, "Point time or 10–15 minute horizon mismatch")
        if set(item.features) != set(FEATURES):
            raise HTTPException(422, "Baseline risk feature schema mismatch")
        if not any(
            stop.tr_id == point.tr_id
            and stop.tt_action_item_id == point.target_stop_id
            and stop.time_begin == point.target_time_begin
            for stop in item.schedule
        ):
            raise HTTPException(422, "Target missing from planned schedule")
        if any(row.tr_id != point.tr_id for row in item.telemetry) or any(
            stop.tr_id != point.tr_id for stop in item.schedule
        ):
            raise HTTPException(422, "Telemetry or schedule vehicle mismatch")
        points.append({
            **point.model_dump(),
            "cur_dev_s": np.nan if point.cur_dev_s is None else point.cur_dev_s,
        })
        telemetry.extend(row.model_dump() for row in item.telemetry)
        schedule.extend(stop.model_dump() for stop in item.schedule)
    try:
        numeric, sequence = build_features(
            pd.DataFrame(points),
            pd.DataFrame(telemetry, columns=TRAFFIC_COLUMNS),
            pd.DataFrame(schedule, columns=PLAN_COLUMNS),
            include_sequence=False,  # Selected ExtraTrees uses numeric features only.
        )
        if sequence.shape != (len(body.items), 30, 8):
            raise ValueError("Invalid causal telemetry sequence shape")
        delay = app.state.sasha.predict(numeric)
        risk_matrix = pd.DataFrame(
            [item.features for item in body.items], columns=FEATURES
        ).astype(float)
        probability = app.state.clf.predict_proba(risk_matrix, thread_count=2)[:, 1]
    except (KeyError, TypeError, ValueError, IndexError) as error:
        raise HTTPException(422, f"Invalid causal features: {error}") from error
    if not np.isfinite(delay).all() or not np.isfinite(probability).all():
        raise HTTPException(503, "Non-finite model output")
    app.state.requests += 1
    app.state.last_ms = round((time.perf_counter() - started) * 1000, 2)
    return {
        "asOf": body.asOf,
        "modelVersion": app.state.metrics["modelVersion"],
        "latencyMs": app.state.last_ms,
        "predictions": [
            {
                "vehicleId": item.vehicleId,
                "delaySec": float(value),
                "lateProbability": float(prob),
            }
            for item, value, prob in zip(body.items, delay, probability)
        ],
    }
