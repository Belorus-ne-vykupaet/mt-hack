"""Reproduce Sasha's model, then run comparable feature/model ablations."""
import argparse,json,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'src'),str(ROOT.parent/'.deps')]
import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import ExtraTreesRegressor,RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline
from catboost import CatBoostRegressor
from mt_hack.features import load_split,build_features

OUT=ROOT/'work/improvement'
OUT.mkdir(parents=True,exist_ok=True)
DATA=ROOT.parent/'data'

def cached(split):
    f=OUT/f'{split}_base.npz'
    pts,tr,plan=load_split(DATA,split)
    if f.exists():
        d=np.load(f);return pd.DataFrame(d['x'],columns=d['names']),d['seq'],pts
    start=time.perf_counter();print('features',split,flush=True)
    x,s=build_features(pts,tr,plan)
    np.savez_compressed(f,x=x.to_numpy(),names=np.array(list(x)),seq=s)
    print('features done',split,round(time.perf_counter()-start,1),flush=True)
    return x,s,pts

def trees(x,y,w,xt,params,name):
    start=time.perf_counter()
    m=make_pipeline(SimpleImputer(strategy='median',add_indicator=True,keep_empty_features=True),
                    ExtraTreesRegressor(n_estimators=params.get('trees',400),
                      min_samples_leaf=params.get('leaf',5),max_features=params.get('features',.8),
                      criterion=params.get('criterion','absolute_error'),bootstrap=params.get('bootstrap',False),
                      max_depth=params.get('depth',None),n_jobs=4,random_state=params.get('seed',2026)))
    m.fit(x,y,extratreesregressor__sample_weight=w)
    pred=m.predict(xt)
    joblib.dump(m,OUT/(name+'.joblib'),compress=3)
    print('fit',name,round(time.perf_counter()-start,1),flush=True)
    return pred,m

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--mode',default='baseline');args=ap.parse_args()
    x,s,p=cached('train');xt,st,pt=cached('test');xv,sv,pv=cached('validate')
    y=p.target_delay_s.to_numpy();yt=pt.target_delay_s.to_numpy();w=np.where(p.tr_id<9000000,1.,.25)
    pred,m=trees(x,y,w,xt,{},'sasha_reproduced')
    score=float(np.abs(pred-yt).mean())
    recorded=pd.read_csv(ROOT/'reports/test_predictions.csv')
    delta=float(np.max(np.abs(pred-recorded.extra_trees)))
    result={'mae':score,'original_mae':58.087528328611896,'max_prediction_difference':delta,'n_train':len(y)}
    print('BASELINE',json.dumps(result),flush=True)
    (OUT/'reproduction.json').write_text(json.dumps(result,indent=2))
    np.save(OUT/'sasha_pred.npy',pred)
    pd.DataFrame({'sample_id':pv.sample_id,'prediction':m.predict(xv)}).to_csv(OUT/'submission_sasha.csv',sep=';',index=False)

if __name__=='__main__':main()
