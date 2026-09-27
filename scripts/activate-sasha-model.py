"""Publish the reproduced Sasha delay model and its matching submission."""

import hashlib
import json
import math
import shutil
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

submission_source = ROOT / "outputs/submission.csv"
submission_target = artifacts / "submission.csv"
if not submission_source.is_file():
    raise SystemExit(f"Missing trained submission: {submission_source}")
actual_hash = hashlib.sha256(submission_source.read_bytes()).hexdigest()
expected_hash = source.get("submission_sha256")
if expected_hash and actual_hash != expected_hash:
    raise SystemExit("outputs/submission.csv does not match reports/metrics.json")
shutil.copy2(submission_source, submission_target)

numeric_features = schema["numeric"]
has_osm = any(name.startswith("osm_") or name.startswith("target_osm_") for name in numeric_features)
has_buslanes = any(name.startswith("buslane_") or name.startswith("target_buslane_") for name in numeric_features)
feature_version = 4 if has_buslanes else 3 if has_osm else 2

metrics = {
    "modelVersion": "olya-extra-trees-osm-v1" if has_osm else "sasha-extra-trees-v2",
    "modelFamily": "ExtraTreesRegressor",
    "featureVersion": feature_version,
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
    "features": numeric_features,
    "sequenceFeatures": schema["sequence"],
    "submissionSha256": actual_hash,
    "evaluation": (
        f"{mae:.2f} s is on the provided test split used to select ExtraTrees; "
        "the hidden evaluation score is separate. The chronological audit is "
        "from a model trained before its audit window."
    ),
    "externalFeaturesUsed": bool(has_osm or has_buslanes),
    "externalFeatureSources": [
        source_name
        for enabled, source_name in ((has_osm, "OpenStreetMap"), (has_buslanes, "buslanes.ru"))
        if enabled
    ],
}
if has_osm:
    osm = json.loads((ROOT / "ml/data/external/osm_cells.json").read_text())
    metrics.update({
        "modelAuthor": "Olya", "sourceBranch": "osm-extra-trees-51",
        "sourceCommit": "f6b64cccabc9c10882babdd72f0b98b57de06f9c",
        "osmSnapshotDate": osm["snapshot_date"],
    })
(artifacts / "metrics.json").write_text(
    json.dumps(metrics, indent=2, ensure_ascii=False) + "\n"
)
print(
    f"Activated {metrics['modelVersion']}: provided-test MAE {mae:.3f} s; "
    f"published {submission_target.relative_to(ROOT)}"
)
