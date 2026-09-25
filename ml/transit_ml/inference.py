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


class Item(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    vehicleId: str
    features: dict[str, float | None]


class Batch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asOf: str
    items: list[Item] = Field(min_length=1, max_length=2000)


@asynccontextmanager
async def lifespan(app):
    root = Path(os.getenv("ML_ARTIFACTS", "ml/artifacts"))
    app.state.reg = CatBoostRegressor()
    app.state.reg.load_model(str(root / "delay.cbm"))
    app.state.clf = CatBoostClassifier()
    app.state.clf.load_model(str(root / "late.cbm"))
    app.state.metrics = json.loads((root / "metrics.json").read_text())
    app.state.requests = 0
    app.state.last_ms = 0
    yield


app = FastAPI(
    title="Transit Hub · CatBoost inference", version="1.0", lifespan=lifespan
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
        "modelVersion": app.state.metrics["modelVersion"],
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
