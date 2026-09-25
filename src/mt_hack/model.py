"""Small residual GRU, preprocessing and portable CPU inference."""
import copy
from pathlib import Path
import joblib
import numpy as np
import torch
from torch import nn
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline

torch.set_num_threads(4)


class DelayGRU(nn.Module):
    def __init__(self, n_features, hidden=24):
        super().__init__()
        self.gru = nn.GRU(8, hidden, batch_first=True)
        self.tab = nn.Sequential(nn.Linear(n_features,48),nn.SiLU(),nn.Dropout(.15))
        self.head = nn.Sequential(nn.Linear(hidden+48,32),nn.SiLU(),nn.Dropout(.1),nn.Linear(32,4))
        self.shrink = nn.Parameter(torch.tensor(.5))

    def forward(self, x, seq, cur):
        _, state=self.gru(seq)
        out=self.head(torch.cat([self.tab(x),state[-1]],dim=1))
        median=self.shrink*cur+out[:,0]
        return torch.stack([median,median-nn.functional.softplus(out[:,1]),
                            median+nn.functional.softplus(out[:,2]),out[:,3]],dim=1)


def tensors(x,seq,cur):
    return [torch.as_tensor(a,dtype=torch.float32) for a in (x,seq,cur/100)]


def neural_predict(model, pre, x, seq):
    model.eval()
    xx=pre.transform(x).astype(np.float32)
    args=tensors(np.clip(xx,-8,8),seq,x['cur_dev_s'].to_numpy())
    with torch.inference_mode():
        out=torch.cat([model(*(v[i:i+512] for v in args)) for i in range(0,len(x),512)]).numpy()
    out[:,:3]*=100
    out[:,3]=1/(1+np.exp(-np.clip(out[:,3],-40,40)))
    return out


def fit_neural(x,seq,y,weights,seed,validation=None,epochs=90):
    torch.manual_seed(seed)
    np.random.seed(seed)
    pre=make_pipeline(SimpleImputer(strategy='median',add_indicator=True,keep_empty_features=True),StandardScaler())
    xx=pre.fit_transform(x).astype(np.float32)
    model=DelayGRU(xx.shape[1])
    args=tensors(np.clip(xx,-8,8),seq,x.cur_dev_s.to_numpy())
    yy=torch.tensor(y/100,dtype=torch.float32);ww=torch.tensor(weights,dtype=torch.float32)
    opt=torch.optim.AdamW(model.parameters(),lr=.0015,weight_decay=.02)
    best,best_epoch,state=float('inf'),0,None
    for epoch in range(1,epochs+1):
        model.train()
        for idx in torch.randperm(len(y)).split(192):
            out=model(*(v[idx] for v in args));err=yy[idx]-out[:,0]
            lo=yy[idx]-out[:,1];hi=yy[idx]-out[:,2]
            risk=nn.functional.binary_cross_entropy_with_logits(out[:,3],(yy[idx]>1.2).float(),reduction='none')
            loss=(ww[idx]*(err.abs()+.15*torch.maximum(.1*lo,-.9*lo)+.15*torch.maximum(.9*hi,-.1*hi)+.08*risk)).mean()
            opt.zero_grad();loss.backward();nn.utils.clip_grad_norm_(model.parameters(),2);opt.step()
        if validation is not None:
            vx,vs,vy=validation
            score=np.abs(neural_predict(model,pre,vx,vs)[:,0]-vy).mean()
            if score<best-.03: best,best_epoch,state=score,epoch,copy.deepcopy(model.state_dict())
            if epoch-best_epoch>=18: break
        else: best_epoch=epoch
    if state is not None:model.load_state_dict(state)
    print(f'GRU seed={seed} epochs={best_epoch} tune_MAE={best:.3f}',flush=True)
    return {'model':model,'pre':pre,'epochs':best_epoch,'seed':seed}


class Predictor:
    """Loads only trusted local artifacts. joblib is not safe for untrusted files."""
    def __init__(self, path='artifacts/model'):
        path=Path(path)
        self.bundle=joblib.load(path/'ensemble.joblib')
        self.networks=[]
        for name in self.bundle['neural_files']:
            checkpoint=torch.load(path/name,map_location='cpu',weights_only=False)
            m=DelayGRU(checkpoint['n_features']);m.load_state_dict(checkpoint['state'])
            self.networks.append((m,checkpoint['pre']))

    def predict(self,x,seq):
        parts={}
        nn_out=np.mean([neural_predict(m,p,x,seq) for m,p in self.networks],axis=0)
        parts['gru']=nn_out[:,0]
        for name in ['extra_trees','catboost','linear']:
            parts[name]=self.bundle[name].predict(x)
        prediction=sum(parts[n]*w for n,w in self.bundle['weights'].items())
        # Uncertainty/risk belongs to the neural head; it is not a calibrated ensemble probability.
        return {'prediction':prediction,'q10_s':nn_out[:,1],'q90_s':nn_out[:,2],
                'neural_late_probability':nn_out[:,3],'components':parts}
