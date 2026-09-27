"""Guard the time boundary and label isolation of the added feature families."""
import numpy as np
import pandas as pd
from mt_hack.enhanced import enhanced_features
from mt_hack.forest import forest_predict
from mt_hack.features import build_features
from sklearn.ensemble import ExtraTreesRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline

def inputs():
    p=pd.DataFrame([dict(sample_id='a',tr_id=1,T='2026-01-06 12:00:00',target_stop_id=3,
                         target_time_begin='2026-01-06 12:12:00',cur_dev_s=25.)])
    t=pd.DataFrame([dict(tr_id=1,event_time=f'2026-01-06 {clock}',location_valid=True,
                         lon=37.50+i*.003,lat=55.70,speed=20.,heading=90.)
                    for i,clock in enumerate(['11:50:00','11:55:00','12:00:00'])])
    s=pd.DataFrame([dict(tt_action_item_id=i+1,tr_id=1,time_begin=f'2026-01-06 {clock}',
                         geom=f'POINT ({37.50+i*.005} 55.7)')
                    for i,clock in enumerate(['11:58:00','12:05:00','12:12:00','12:18:00'])])
    return p,t,s

def test_future_poisoning_does_not_change_enhanced_features():
    p,t,s=inputs();expected=enhanced_features(p,t,s)
    future=t.copy();future.event_time='2026-01-06 12:00:00.001';future.speed=155;future.lon=38.5
    actual=enhanced_features(p,pd.concat([t,future],ignore_index=True),s)
    pd.testing.assert_frame_equal(actual,expected)

def test_labels_and_actual_arrivals_are_excluded():
    p,t,s=inputs();expected=enhanced_features(p,t,s)
    p['target_delay_s']=1e10;p['target_class']='poison';s['time_fact_begin']='2099-01-01';s['manual_fill']=True
    pd.testing.assert_frame_equal(enhanced_features(p,t,s),expected)

def test_zero_gps_is_missing_and_empty_history_supported():
    p,t,s=inputs();t[['lon','lat']]=0
    a=enhanced_features(p,t,s)
    assert a.motion_stale_gps.iloc[0]==5400
    b=enhanced_features(p,t.iloc[:0],s)
    assert b.motion_stale_gps.iloc[0]==5400

def test_one_plan_stop_does_not_require_route_segments():
    p,t,s=inputs()
    a=enhanced_features(p,t,s[s.tt_action_item_id==3])
    assert a.ctx_stops_adjusted.iloc[0]==0

def test_median_aggregates_individual_tree_predictions():
    x=pd.DataFrame({'a':range(12),'b':[np.nan]+list(range(11))});y=np.array([0]*8+[100]*4)
    model=make_pipeline(SimpleImputer(add_indicator=True),ExtraTreesRegressor(n_estimators=11,random_state=1,n_jobs=1))
    model.fit(x,y)
    query=pd.DataFrame({'a':[3.5,8.5],'b':[np.nan,8.]})
    xx=model[0].transform(query).astype('float32')
    expected=np.median([t.predict(xx) for t in model[-1].estimators_],axis=0)
    np.testing.assert_array_equal(forest_predict(model,query,'median'),expected)

def test_disabling_unused_sequence_preserves_all_tree_inputs():
    p,t,s=inputs()
    old,_=build_features(p,t,s)
    new,sequence=build_features(p,t,s,sequence_bins=0)
    pd.testing.assert_frame_equal(new,old)
    assert sequence.shape==(1,0,8)
