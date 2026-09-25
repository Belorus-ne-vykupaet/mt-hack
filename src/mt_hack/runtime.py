"""Lightweight runtime for the selected Sasha tree model.

Training and comparison still use PyTorch in ``mt_hack.model``. The deployed
ExtraTrees candidate does not need to load GRU checkpoints or CUDA packages.
"""

from pathlib import Path

import joblib
import numpy as np


class SelectedDelayModel:
    def __init__(self, path: str | Path):
        self.bundle = joblib.load(Path(path) / "ensemble.joblib")
        self.feature_names = self.bundle["feature_names"]
        weights = self.bundle["weights"]
        if weights.get("gru", 0) > 0:
            raise ValueError("The selected model needs the PyTorch runtime")
        self.components = [
            (self.bundle[name], float(weight))
            for name, weight in weights.items()
            if weight > 0
        ]
        if not self.components:
            raise ValueError("No selected regression model")

    def predict(self, features):
        if list(features) != self.feature_names:
            raise ValueError("Feature schema differs from the trained model")
        output = sum(model.predict(features) * weight for model, weight in self.components)
        if not np.isfinite(output).all():
            raise ValueError("Non-finite regression output")
        return output
