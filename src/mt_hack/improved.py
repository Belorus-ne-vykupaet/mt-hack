"""Saved median-forest ensemble: the same features for training and inference."""
import json
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from .features import build_features
from .enhanced import enhanced_features
from .forest import forest_values

def feature_frame(group,base,enhanced):
    if group=='base':return base
    extra=enhanced if group=='all' else enhanced[[c for c in enhanced if c.startswith(group+'_')]]
    return pd.concat([base,extra],axis=1)

class ImprovedPredictor:
    def __init__(self,path):
        self.path=Path(path)
        self.manifest=json.loads((self.path/'manifest.json').read_text())
        # Only load artifacts produced by this trusted training pipeline.
        self.models=[(m,joblib.load(self.path/m['file'])) for m in self.manifest['models']]

    def predict_features(self,base,enhanced):
        groups={}
        for metadata,m in self.models:
            frame=feature_frame(metadata['group'],base,enhanced)
            groups.setdefault(metadata['group'],[]).append(forest_values(m,frame))
        values={g:np.median(np.concatenate(arrays,axis=0),axis=0) for g,arrays in groups.items()}
        result=sum(self.manifest['group_weights'][g]*p for g,p in values.items())
        if not np.isfinite(result).all():raise ValueError('Non-finite prediction')
        return result

    def predict(self,points,traffic,plan):
        base,_=build_features(points,traffic,plan,sequence_bins=0)
        enhanced=enhanced_features(points,traffic,plan)
        return self.predict_features(base,enhanced)
