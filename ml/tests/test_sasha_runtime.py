"""The lightweight online runtime must match Sasha's scored model exactly."""

from pathlib import Path

import numpy as np

from mt_hack.features import build_features, load_split
from mt_hack.model import Predictor
from mt_hack.runtime import SelectedDelayModel


def test_online_tree_runtime_matches_scored_predictor():
    model_path = Path("ml/artifacts/sasha")
    points, traffic, plan = load_split("ml/data/official", "test")
    features, sequences = build_features(points.head(12), traffic, plan)
    scored = Predictor(model_path).predict(features, sequences)["prediction"]
    live = SelectedDelayModel(model_path).predict(features)
    np.testing.assert_allclose(live, scored, rtol=0, atol=1e-10)
