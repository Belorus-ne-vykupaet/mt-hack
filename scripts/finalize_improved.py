"""Repeat frozen configurations with independent seeds; audit and refit for submission."""
from tune_improved import *
from mt_hack.forest import forest_values
from mt_hack.augmentation_audit import no_heldout_copies
from mt_hack.improved import feature_frame,ImprovedPredictor
from mt_hack.features import seconds
import shutil

SEEDS=[2026,17,43]
CONFIG=dict(leaf=1,features=.4,residual=0,weight=.25,trees=400,criterion='squared_error')
GROUPS=['ctx','all']

def train_bundle(x,e,p,xt,et,mask,prefix,dest):
    dest.mkdir(parents=True,exist_ok=True)
    manifest={'format_version':1,'aggregation':'median of all trees within a feature group',
              'group_weights':{'ctx':.5,'all':.5},'models':[],'seeds':SEEDS,'training_rows':int(mask.sum())}
    preds={};seed_scores={};y=p.target_delay_s.to_numpy();w=np.where(p.tr_id<9000000,1.,.25)
    for group in GROUPS:
        xx=feature_frame(group,x,e);tt=feature_frame(group,xt,et);preds[group]=[]
        for seed in SEEDS:
            name=f'{prefix}_{group}_{seed}';path=OUT/(name+'.joblib')
            original=OUT/('fast_3.joblib' if group=='ctx' else 'fast_9.joblib')
            if path.exists():m=joblib.load(path)
            elif prefix=='full' and seed==2026 and original.exists():m=joblib.load(original)
            else:
                _,m=trees(xx.loc[mask],y[mask],w[mask],tt,CONFIG|{'seed':seed},name)
            values=forest_values(m,tt);preds[group].append(values)
            filename=f'{group}_{seed}.joblib';joblib.dump(m,dest/filename,compress=3)
            manifest['models'].append({'file':filename,'group':group,'seed':seed})
            seed_scores[f'{group}_{seed}']=np.median(values,axis=0)
        print('bundle',prefix,group,'ready',flush=True)
    (dest/'manifest.json').write_text(json.dumps(manifest,indent=2))
    gp={g:np.median(np.concatenate(a),axis=0) for g,a in preds.items()}
    pred=.5*gp['ctx']+.5*gp['all']
    return pred,seed_scores

def save_csv(name,pred,points):
    output=ROOT/'outputs';output.mkdir(exist_ok=True)
    template=pd.read_csv(DATA/'sample_submission.csv',sep=';')
    lookup=pd.Series(pred,index=points.sample_id)
    template['prediction']=template.sample_id.map(lookup)
    assert len(template)==len(points) and template.sample_id.is_unique and np.isfinite(template.prediction).all()
    template.to_csv(output/name,sep=';',index=False,float_format='%.6f')

def main():
    x,s,p=cached('train');xt,st,pt=cached('test');xv,sv,pv=cached('validate')
    e=extra('train');et=extra('test').reindex(columns=e.columns);ev=extra('validate').reindex(columns=e.columns)
    _,_,plan=load_split(DATA,'train');mask,sources=no_heldout_copies(p,plan,pd.concat([pt,pv]))
    yt=pt.target_delay_s.to_numpy();metrics={'configuration':CONFIG,'seeds':SEEDS,'groups':GROUPS,
        'reference_sasha_mae':58.087528328611896,'reference_main_mae':62.68858066458513,
        'evaluation':'Provided test is a tuning/selection set, not independent final data.',
        'removed_synthetic_rows':int((~mask).sum())}
    for name,train_mask in [('full',np.ones(len(p),dtype=bool)),('purged',mask)]:
        dest=ROOT/'artifacts'/('improved_'+name)
        pred,seedp=train_bundle(x,e,p,xt,et,train_mask,name,dest)
        model=ImprovedPredictor(dest)
        metrics[name]={'mae_s':float(np.abs(pred-yt).mean()),'rows':int(train_mask.sum()),
                       'seed_mae_s':{k:float(np.abs(v-yt).mean()) for k,v in seedp.items()}}
        pp=model.predict_features(xv,ev);save_csv('submission_'+name+'_train_only.csv',pp,pv)
        pd.DataFrame({'sample_id':pt.sample_id,'target':yt,'prediction':pred,'vehicle':pt.tr_id}).to_csv(ROOT/'reports'/('improved_'+name+'_test.csv'),index=False)
        (ROOT/'reports/improvement_metrics.json').write_text(json.dumps(metrics,indent=2))
        print('EVALUATION',name,json.dumps(metrics[name]),flush=True)
    # Same chronological stress split as the branch; not used to choose the new model.
    cutoff=pd.Timestamp('2026-01-06 16:00:00',tz='UTC').timestamp();audit_start=pd.Timestamp('2026-01-06 20:00:00',tz='UTC').timestamp()
    known=seconds(p.target_time_begin)+p.target_delay_s.to_numpy();t=seconds(p['T'])
    chronological=(known<cutoff-1800)&(t<cutoff-1800);audit=(t>=audit_start)&(p.tr_id<9000000)
    chronological_preds=[]
    for group in GROUPS:
        xx=feature_frame(group,x,e)
        _,m=trees(xx.loc[chronological],p.target_delay_s.to_numpy()[chronological],np.where(p.tr_id[chronological]<9000000,1.,.25),
                  xx.loc[audit],CONFIG|{'seed':2026},'chronological_'+group)
        chronological_preds.append(np.median(forest_values(m,xx.loc[audit]),axis=0))
    chronological_pred=np.mean(chronological_preds,axis=0)
    metrics['chronological_stress']={'mae_s':float(np.abs(chronological_pred-p.target_delay_s.to_numpy()[audit]).mean()),
                                     'train_rows':int(chronological.sum()),'audit_rows':int(audit.sum()),
                                     'reference_sasha_mae_s':57.79947695035462}
    print('CHRONOLOGICAL',json.dumps(metrics['chronological_stress']),flush=True)
    # No validate label is read. The README authorizes training on supplied train + test.
    combined_x=pd.concat([x,xt],ignore_index=True);combined_e=pd.concat([e,et],ignore_index=True)
    combined_p=pd.concat([p,pt],ignore_index=True)
    pred,_=train_bundle(combined_x,combined_e,combined_p,xv,ev,np.ones(len(combined_p),dtype=bool),'final',ROOT/'artifacts/improved_final')
    save_csv('submission_improved.csv',pred,pv)
    metrics['final_training_rows']=len(combined_p)
    metrics['submission_rows']=len(pred)
    (ROOT/'reports/improvement_metrics.json').write_text(json.dumps(metrics,indent=2))
    print('FINAL',json.dumps(metrics,indent=2),flush=True)

if __name__=='__main__':main()
