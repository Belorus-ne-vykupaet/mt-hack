"""Reproduce an improved submission directly from CSVs and trained artifacts."""
import argparse,json,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'src'),str(ROOT.parent/'.deps')]
import numpy as np
import pandas as pd
from mt_hack.features import load_split
from mt_hack.improved import ImprovedPredictor

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--data',type=Path,default=ROOT.parent/'data')
    ap.add_argument('--model',type=Path,default=ROOT/'artifacts/improved_final')
    ap.add_argument('--output',type=Path,default=ROOT/'outputs/submission_reproduced.csv')
    args=ap.parse_args()
    p,t,s=load_split(args.data,'validate');started=time.perf_counter()
    model=ImprovedPredictor(args.model);load_s=time.perf_counter()-started
    started=time.perf_counter();pred=model.predict(p,t,s);predict_s=time.perf_counter()-started
    template=pd.read_csv(args.data/'sample_submission.csv',sep=';')
    template['prediction']=template.sample_id.map(pd.Series(pred,index=p.sample_id))
    if not template.sample_id.is_unique or len(template)!=len(p) or not np.isfinite(template.prediction).all():
        raise ValueError('Invalid submission coverage')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    template.to_csv(args.output,sep=';',index=False,float_format='%.6f')
    stats={'rows':len(p),'model_load_seconds':load_s,'feature_and_inference_seconds':predict_s,'output':str(args.output)}
    args.output.with_suffix('.timing.json').write_text(json.dumps(stats,indent=2))
    print(json.dumps(stats,indent=2))

if __name__=='__main__':main()
