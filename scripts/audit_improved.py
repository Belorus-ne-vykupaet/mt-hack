from tune_improved import *
from mt_hack.augmentation_audit import no_heldout_copies
from mt_hack.forest import forest_predict

def main():
    x,s,p=cached('train');xt,st,pt=cached('test');_,_,pv=cached('validate')
    _,_,plan=load_split(DATA,'train')
    mask,source=no_heldout_copies(p,plan,pd.concat([pt,pv]))
    y=p.target_delay_s.to_numpy();yt=pt.target_delay_s.to_numpy();w=np.where(p.tr_id<9000000,1.,.25)
    e=extra('train');et=extra('test').reindex(columns=e.columns)
    result=json.loads((OUT/'purged_audit.json').read_text()) if (OUT/'purged_audit.json').exists() else {'rows_full':len(p),'rows_purged':int(mask.sum()),'removed':int((~mask).sum())}
    for name,group,leaf in [('sasha_purged','base',5),('leaf1_purged','base',1),('all_leaf1_purged','all',1),('ctx_leaf1_purged','ctx',1)]:
        if name in result:continue
        xx=frames(group,x,e);tt=frames(group,xt,et)
        pred,m=trees(xx.loc[mask],y[mask],w[mask],tt,{'leaf':leaf,'trees':240},name)
        result[name]=float(np.abs(pred-yt).mean());np.save(OUT/(name+'_pred.npy'),pred)
        print('AUDIT',name,result[name],flush=True)
        (OUT/'purged_audit.json').write_text(json.dumps(result,indent=2))
    for name,group in [('sasha_purged','base'),('leaf1_purged','base'),('all_leaf1_purged','all'),('ctx_leaf1_purged','ctx')]:
        m=joblib.load(OUT/(name+'.joblib'))
        pred=forest_predict(m,frames(group,xt,et),'median')
        result[name+'_median']=float(np.abs(pred-yt).mean())
        np.save(OUT/(name+'_median_pred.npy'),pred)
    (OUT/'purged_audit.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2),flush=True)

if __name__=='__main__':main()
