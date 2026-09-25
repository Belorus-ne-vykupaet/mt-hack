"""Regenerate and validate a competition submission from a saved model."""
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
from mt_hack.features import load_split,build_features
from mt_hack.model import Predictor


def validate_submission(submission,template):
    if list(submission)!=['sample_id','prediction']:raise ValueError('Expected sample_id;prediction')
    if submission.sample_id.duplicated().any():raise ValueError('Duplicate IDs')
    if set(submission.sample_id)!=set(template.sample_id):raise ValueError('IDs differ from template')
    if not np.isfinite(submission.prediction.to_numpy(dtype=float)).all():raise ValueError('Non-finite prediction')


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--data',default='data/raw');ap.add_argument('--model',default='artifacts/model');ap.add_argument('--out',default='outputs/submission.csv');args=ap.parse_args()
    points,traffic,plan=load_split(args.data,'validate');x,s=build_features(points,traffic,plan)
    prediction=Predictor(args.model).predict(x,s)['prediction']
    submission=pd.DataFrame({'sample_id':points.sample_id,'prediction':prediction})
    template=pd.read_csv(Path(args.data)/'sample_submission.csv',sep=';')
    validate_submission(submission,template)
    submission=template[['sample_id']].merge(submission,on='sample_id',how='left',validate='one_to_one')
    out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True);submission.to_csv(out,sep=';',index=False)
    print(f'Validated {len(submission)} predictions: {out}')
if __name__=='__main__':main()
