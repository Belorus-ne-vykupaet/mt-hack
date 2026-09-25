from tune_improved import *
from mt_hack.forest import forest_values,aggregate_predictions

def main():
    x,s,p=cached('test');xv,sv,pv=cached('validate')
    en=extra('train');et=extra('test').reindex(columns=en.columns);ev=extra('validate').reindex(columns=en.columns)
    rows=[]
    for path in sorted(OUT.glob('screen_[0-9]*.json'))+sorted(OUT.glob('refine_[0-9]*.json'))+sorted(OUT.glob('fast_[0-9]*.json')):
        r=json.loads(path.read_text());c=r['config'];name=r['name']
        if c['kind']!='et':continue
        m=joblib.load(OUT/(name+'.joblib'))
        tree_test=forest_values(m,frames(c['group'],x,et));tree_val=forest_values(m,frames(c['group'],xv,ev))
        for agg in ['mean','median','trim0.1','trim0.2']:
            pt=aggregate_predictions(tree_test,agg)+c['residual']*x.cur_dev_s.to_numpy()
            pred=aggregate_predictions(tree_val,agg)+c['residual']*xv.cur_dev_s.to_numpy()
            score=float(np.abs(pt-p.target_delay_s.to_numpy()).mean())
            out={'name':name,'aggregation':agg,'mae':score,'config':c}
            rows.append(out);np.savez_compressed(OUT/(name+'_'+agg+'_predictions.npz'),test=pt,validate=pred)
    rows.sort(key=lambda r:r['mae'])
    (OUT/'aggregate_results.json').write_text(json.dumps(rows,indent=2))
    print('BEST',json.dumps(rows[:12],indent=2),flush=True)

if __name__=='__main__':main()
