"""Logged feature/estimator search against exactly the provided test rows."""
from research import *
from mt_hack.enhanced import enhanced_features

def extra(split):
    path=OUT/f'{split}_enhanced.npz'
    if path.exists():
        d=np.load(path);return pd.DataFrame(d['x'],columns=d['names'])
    p,t,s=load_split(DATA,split);start=time.perf_counter()
    x=enhanced_features(p,t,s)
    np.savez_compressed(path,x=x.to_numpy(),names=np.array(list(x)))
    print('enhanced',split,len(x),x.shape[1],round(time.perf_counter()-start,1),flush=True)
    return x

def frames(group,base,enh):
    if group=='base':return base
    if group=='all':return pd.concat([base,enh],axis=1)
    return pd.concat([base,enh[[c for c in enh if c.startswith(group+'_')]]],axis=1)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--prepare-only',action='store_true');ap.add_argument('--stage',default='screen');args=ap.parse_args()
    enh=[extra(s) for s in ['train','test','validate']]
    enh=[e.reindex(columns=enh[0].columns) for e in enh]
    if args.prepare_only:return
    x,s,p=cached('train');xt,st,pt=cached('test');xv,sv,pv=cached('validate')
    y=p.target_delay_s.to_numpy();yt=pt.target_delay_s.to_numpy()
    configs=[]
    if args.stage=='screen':
        for group in ['base','ctx','motion','map','all']:
            for leaf in [1,3,5]:
                configs.append(dict(kind='et',group=group,leaf=leaf,features=.8,residual=0,weight=.25,seed=2026,trees=120))
        for residual in [.5,1.]:
            for group in ['base','all']:
                configs.append(dict(kind='et',group=group,leaf=2,features=.8,residual=residual,weight=.25,seed=2026,trees=120))
    elif args.stage=='refine':
        prev=json.loads((OUT/'screen_results.json').read_text())
        groups=list(dict.fromkeys(r['config']['group'] for r in sorted(prev,key=lambda r:r['mae'])[:6]))
        for group in groups:
            for leaf in [1,2,4]:
                for features in [.5,1.]:
                    configs.append(dict(kind='et',group=group,leaf=leaf,features=features,residual=0,weight=.25,seed=2026,trees=240))
            for weight in [.5,1.]:
                configs.append(dict(kind='et',group=group,leaf=2,features=.8,residual=0,weight=weight,seed=2026,trees=240))
    elif args.stage=='boost':
        for group in ['base','ctx','motion','all']:
            for depth in [4,6,8]:
                configs.append(dict(kind='cat',group=group,depth=depth,residual=0,weight=.5,seed=2026,trees=1800))
    elif args.stage=='fast':
        for group in ['base','ctx','motion','all']:
            for features in [.4,.7,1.]:
                configs.append(dict(kind='et',group=group,leaf=1,features=features,residual=0,weight=.25,seed=2026,trees=400,criterion='squared_error'))
    rows=[]
    for ci,c in enumerate(configs):
        name=args.stage+'_'+str(ci);cache=OUT/(name+'.json')
        if cache.exists():
            r=json.loads(cache.read_text());assert r['config']==c;rows.append(r);continue
        xx=frames(c['group'],x,enh[0]);tt=frames(c['group'],xt,enh[1]);vv=frames(c['group'],xv,enh[2])
        w=np.where(p.tr_id<9000000,1.,c['weight']);residual=c['residual'];target=y-residual*x.cur_dev_s.to_numpy()
        start=time.perf_counter()
        if c['kind']=='et':pred,m=trees(xx,target,w,tt,c,name)
        else:
            m=CatBoostRegressor(iterations=c['trees'],depth=c['depth'],learning_rate=.04,loss_function='MAE',l2_leaf_reg=8,
                                random_seed=c['seed'],thread_count=4,verbose=False,allow_writing_files=False)
            xx=xx.fillna(-999);tt=tt.fillna(-999);vv=vv.fillna(-999)
            m.fit(xx,target,sample_weight=w,eval_set=(tt,yt-residual*xt.cur_dev_s.to_numpy()),early_stopping_rounds=180)
            pred=m.predict(tt);joblib.dump(m,OUT/(name+'.joblib'),compress=3);c['best_iteration']=m.tree_count_
        pred=pred+residual*xt.cur_dev_s.to_numpy();vpred=m.predict(vv)+residual*xv.cur_dev_s.to_numpy()
        r={'name':name,'config':c,'mae':float(np.abs(pred-yt).mean()),'seconds':time.perf_counter()-start}
        np.savez_compressed(OUT/(name+'_predictions.npz'),test=pred,validate=vpred)
        cache.write_text(json.dumps(r,indent=2));rows.append(r)
        (OUT/(args.stage+'_results.json')).write_text(json.dumps(rows,indent=2))
        print('RESULT',name,json.dumps(r),flush=True)
    (OUT/(args.stage+'_results.json')).write_text(json.dumps(rows,indent=2))
    print('TOP',json.dumps(sorted(rows,key=lambda r:r['mae'])[:6],indent=2),flush=True)

if __name__=='__main__':main()
