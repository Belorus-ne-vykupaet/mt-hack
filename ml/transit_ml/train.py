"""Train an intentionally small CatBoost baseline; evaluate only on official test split."""

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from catboost import CatBoostClassifier, CatBoostRegressor

from .features import FEATURES, Dataset


def train(data: Path, output: Path):
    output.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    train_points = pd.read_csv(data / "labels/labels_train.csv")
    test_points = pd.read_csv(data / "labels/labels_test.csv")
    print("Building causal train/test features...", flush=True)
    train_x = Dataset(data / "train").matrix(train_points)
    test_x = Dataset(data / "test").matrix(test_points)
    if set(train_points.sample_id) & set(test_points.sample_id):
        raise ValueError("Train/test sample IDs overlap")
    # Fixed training budget: test set is never used for fitting or early stopping.
    reg = CatBoostRegressor(
        iterations=300,
        depth=5,
        learning_rate=0.07,
        loss_function="MAE",
        random_seed=42,
        thread_count=4,
        verbose=False,
        allow_writing_files=False,
    )
    reg.fit(train_x, train_points.target_delay_s)
    classifier = CatBoostClassifier(
        iterations=200,
        depth=4,
        learning_rate=0.05,
        loss_function="Logloss",
        random_seed=42,
        thread_count=4,
        verbose=False,
        allow_writing_files=False,
    )
    classifier.fit(train_x, (train_points.target_delay_s > 120).astype(int))
    pred = reg.predict(test_x)
    probability = classifier.predict_proba(test_x)[:, 1]
    y = test_points.target_delay_s.to_numpy()
    metrics = {
        "modelVersion": "catboost-official-v1",
        "featureVersion": 1,
        "trainRows": len(train_points),
        "testRows": len(test_points),
        "maeSec": float(np.mean(np.abs(y - pred))),
        "persistenceMaeSec": float(
            np.mean(np.abs(y - test_points.cur_dev_s.to_numpy()))
        ),
        "zeroMaeSec": float(np.mean(np.abs(y))),
        "riskBrier": float(np.mean((probability - (y > 120)) ** 2)),
        "riskThresholdSec": 120,
        "horizon": "(600, 900] seconds",
        "features": FEATURES,
        "featureImportance": dict(
            sorted(
                zip(FEATURES, map(float, reg.feature_importances_)), key=lambda p: -p[1]
            )
        ),
        "trainingSeconds": round(time.monotonic() - start, 2),
        "trainLabelsSha256": hashlib.sha256(
            (data / "labels/labels_train.csv").read_bytes()
        ).hexdigest(),
        "evaluation": "Official test split, no test fitting or early stopping. Local MAE, not leaderboard score.",
        "probabilityNote": "Separate late>120s classifier; probability is not calibrated.",
        "externalFeaturesUsed": False,
    }
    reg.save_model(str(output / "delay.cbm"))
    classifier.save_model(str(output / "late.cbm"))
    (output / "metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2) + "\n"
    )
    pd.DataFrame(
        {
            "sample_id": test_points.sample_id,
            "actual": y,
            "prediction": pred,
            "late_probability": probability,
        }
    ).to_csv(output / "test_predictions.csv", index=False)
    points = pd.read_csv(data / "validate/points.csv")
    prediction = reg.predict(Dataset(data / "validate").matrix(points))
    submission = pd.DataFrame({"sample_id": points.sample_id, "prediction": prediction})
    template = pd.read_csv(data / "sample_submission.csv", sep=";")
    if (
        submission.sample_id.duplicated().any()
        or set(template.sample_id) != set(submission.sample_id)
        or not np.isfinite(prediction).all()
    ):
        raise ValueError("Submission coverage/finite values failed")
    submission.set_index("sample_id").loc[template.sample_id].reset_index().to_csv(
        output / "submission.csv", sep=";", index=False
    )
    print(json.dumps(metrics, ensure_ascii=False, indent=2), flush=True)
    print(
        f"Saved {len(submission)} predictions to {output / 'submission.csv'}",
        flush=True,
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--data", type=Path, default=Path("ml/data/official"))
    p.add_argument("--output", type=Path, default=Path("ml/artifacts"))
    args = p.parse_args()
    train(args.data, args.output)
