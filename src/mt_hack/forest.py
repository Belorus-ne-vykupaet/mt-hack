"""MAE-oriented aggregation of fitted regression trees."""
import numpy as np

def forest_values(pipeline,x):
    """Return one row of predictions per tree, in a deterministic order."""
    x=x.reindex(columns=pipeline.feature_names_in_)
    xx=pipeline[0].transform(x).astype(np.float32)
    return np.array([tree.predict(xx,check_input=False) for tree in pipeline[-1].estimators_])

def aggregate_predictions(predictions,aggregation='median'):
    if aggregation=='mean':return predictions.mean(axis=0)
    if aggregation=='median':return np.median(predictions,axis=0)
    if aggregation.startswith('trim'):
        fraction=float(aggregation[4:]);n=int(len(predictions)*fraction)
        return np.sort(predictions,axis=0)[n:len(predictions)-n].mean(axis=0)
    raise ValueError(aggregation)

def forest_predict(pipeline,x,aggregation='median'):
    """Leaf predictions are aggregated by median for absolute-error loss."""
    return aggregate_predictions(forest_values(pipeline,x),aggregation)
