"""Verify the exported predictions and poison future inputs through the real model."""
from predict_improved import *

def main():
    original=pd.read_csv(ROOT/'outputs/submission_improved.csv',sep=';')
    reproduced=pd.read_csv(ROOT/'outputs/submission_reproduced.csv',sep=';')
    template=pd.read_csv(ROOT.parent/'data/sample_submission.csv',sep=';')
    assert list(original)==['sample_id','prediction']
    assert original.sample_id.tolist()==template.sample_id.tolist()==reproduced.sample_id.tolist()
    assert original.sample_id.is_unique and len(original)==151 and np.isfinite(original.prediction).all()
    error=float(np.max(np.abs(original.prediction-reproduced.prediction)))
    assert error<=1e-6,error
    p,t,s=load_split(ROOT.parent/'data','validate');p=p.iloc[[50]].copy()
    m=ImprovedPredictor(ROOT/'artifacts/improved_final')
    expected=m.predict(p,t,s)
    after=pd.to_datetime(t.event_time,format='mixed')>pd.Timestamp(p['T'].iloc[0])
    t.loc[after,['speed','lon','lat']]=[150.,38.8,56.8]
    t.loc[after,'location_valid']=False
    s['time_fact_begin']='2099-01-01 00:00:00';p['target_delay_s']=999999;p['target_class']='poison'
    actual=m.predict(p,t,s)
    np.testing.assert_array_equal(expected,actual)
    result={'submission_rows':len(original),'max_csv_reproduction_error_s':error,
            'model_future_poisoning':'passed','future_rows_changed':int(after.sum()),
            'checks':['csv_contract','saved_model_reproduction','future_and_label_poisoning']}
    (ROOT/'reports/improvement_verification.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
