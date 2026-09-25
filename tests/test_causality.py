import numpy as np
import pandas as pd
import pytest
from mt_hack.features import build_features,seconds
from mt_hack.service import PredictRequest


def fixture():
    point=pd.DataFrame([dict(sample_id='x',tr_id=1,T='2026-01-06 12:00:00',target_stop_id=11,target_time_begin='2026-01-06 12:12:00',cur_dev_s=10.)])
    traffic=pd.DataFrame([dict(tr_id=1,event_time='2026-01-06 11:59:45',location_valid=True,lon=37.5,lat=55.7,speed=20.,heading=90.)])
    plan=pd.DataFrame([dict(tt_action_item_id=11,tr_id=1,time_begin='2026-01-06 12:12:00',geom='POINT (37.51 55.71)')])
    return point,traffic,plan


def test_future_telemetry_cannot_change_prediction_inputs():
    p,t,s=fixture();x,a=build_features(p,t,s)
    future=t.copy();future.event_time='2026-01-06 12:00:01';future.speed=150.;future.lon=100.
    xx,b=build_features(p,pd.concat([t,future]),s)
    pd.testing.assert_frame_equal(x,xx);np.testing.assert_array_equal(a,b)


def test_fact_and_target_columns_cannot_enter_features():
    p,t,s=fixture();x,a=build_features(p,t,s)
    s['time_fact_begin']='2099-01-01';p['target_delay_s']=999999;p['target_class']='late'
    xx,b=build_features(p,t,s)
    pd.testing.assert_frame_equal(x,xx);np.testing.assert_array_equal(a,b)


def test_invalid_gps_does_not_produce_distance():
    p,t,s=fixture();t.location_valid=False
    x,_=build_features(p,t,s)
    assert np.isnan(x.target_distance_km.iloc[0])
    assert x.gps_age_s.iloc[0]==3600


def test_no_telemetry_and_other_vehicle_are_supported():
    p,t,s=fixture();t.tr_id=2
    x,a=build_features(p,t,s)
    assert x.telemetry_age_s.iloc[0]==3600
    assert not a.any()
    xx,b=build_features(p,t.iloc[:0],s)
    pd.testing.assert_frame_equal(x,xx);np.testing.assert_array_equal(a,b)


@pytest.mark.parametrize('time',['2026-01-06 12:10:00','2026-01-06 12:15:01','2026-01-06 11:00:00'])
def test_horizon_is_enforced(time):
    p,t,s=fixture();p.target_time_begin=time
    with pytest.raises(ValueError):build_features(p,t,s)


def test_exact_T_is_available_but_sequences_have_no_future_bin():
    p,t,s=fixture();t.event_time='2026-01-06 12:00:00'
    x,a=build_features(p,t,s)
    assert x.telemetry_age_s.iloc[0]==0
    assert a[0,-1,-1]==1 and not a[0,:-1,-1].any()


def test_pandas_time_units_are_seconds():
    assert seconds(pd.Series(['2026-01-06 12:00:00']))[0]==1767700800


def test_timezone_equivalent_inputs_produce_identical_features():
    p,t,s=fixture();x,a=build_features(p,t,s)
    p['T']='2026-01-06T15:00:00+03:00';p['target_time_begin']='2026-01-06T15:12:00+03:00'
    t['event_time']='2026-01-06T11:59:45Z';s['time_begin']='2026-01-06T12:12:00Z'
    xx,b=build_features(p,t,s)
    pd.testing.assert_frame_equal(x,xx);np.testing.assert_array_equal(a,b)
