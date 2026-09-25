"""Publish the reproduced Sasha delay model as the live project's model metadata."""

import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
artifacts = ROOT / "ml/artifacts"
model = artifacts / "sasha/ensemble.joblib"
source = json.loads((ROOT / "reports/metrics.json").read_text())
schema = json.loads((ROOT / "ml/data/sasha-features/schema.json").read_text())
baseline = json.loads((artifacts / "metrics.json").read_text())
selection = source["final_selection"]
if not model.is_file() or selection["candidate"] != "extra_trees":
    raise SystemExit("The saved Sasha ExtraTrees model is missing or selection changed")
mae = float(source["provided_test"]["extra_trees"])
if not math.isfinite(mae):
    raise SystemExit("Invalid MAE")

metrics = {
    "modelVersion": "sasha-extra-trees-v2",
    "modelFamily": "ExtraTreesRegressor",
    "featureVersion": 2,
    "trainRows": 4434,
    "testRows": int(source["provided_test"]["n"]),
    "maeSec": mae,
    "persistenceMaeSec": float(source["provided_test"]["persistence"]),
    "zeroMaeSec": float(source["provided_test"]["zero"]),
    "chronologicalHoldoutMaeSec": float(source["chronological_holdout"]["extra_trees"]),
    "riskBrier": baseline["riskBrier"],
    "riskThresholdSec": 120,
    "riskModel": "catboost-official-v1",
    "riskProbabilityCalibrated": False,
    "horizon": "(600, 900] seconds",
    "features": schema["numeric"],
    "sequenceFeatures": schema["sequence"],
    "submissionSha256": source["submission_sha256"],
    "evaluation": (
        "58.09 s is on the provided test split used to select ExtraTrees; "
        "the hidden evaluation score is separate. The chronological audit is "
        "from a model trained before its audit window."
    ),
    "externalFeaturesUsed": False,
}
(artifacts / "metrics.json").write_text(
    json.dumps(metrics, indent=2, ensure_ascii=False) + "\n"
)
print(f"Activated {metrics['modelVersion']}: provided-test MAE {mae:.3f} s")
