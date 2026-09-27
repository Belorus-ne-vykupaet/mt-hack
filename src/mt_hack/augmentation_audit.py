"""Group synthetic examples by their original planned arrival, using plan only."""
import numpy as np
import pandas as pd
from .features import PLAN_COLUMNS,seconds

def source_stops(plan):
    plan=plan[PLAN_COLUMNS].copy();plan['_t']=seconds(plan.time_begin)
    real={v:g for v,g in plan[plan.tr_id<9000000].groupby('tr_id')}
    source={}
    for v,g in plan.groupby('tr_id'):
        candidates=[a for a in real.values() if len(a)==len(g) and np.array_equal(a.geom.to_numpy(),g.geom.to_numpy())]
        if len(candidates)!=1:raise ValueError(f'Cannot identify a unique original plan for {v}')
        a=candidates[0]
        if np.ptp(g['_t'].to_numpy()-a['_t'].to_numpy())>.01:raise ValueError('Plan shift is not constant')
        source.update(zip(g.tt_action_item_id,a.tt_action_item_id))
    return source

def no_heldout_copies(train_points,plan,heldout_points):
    source=source_stops(plan)
    targets=train_points.target_stop_id.map(source)
    forbidden=set(heldout_points.target_stop_id)
    mask=~targets.isin(forbidden)
    assert not (set(targets[mask])&forbidden)
    return mask.to_numpy(),targets.to_numpy()
