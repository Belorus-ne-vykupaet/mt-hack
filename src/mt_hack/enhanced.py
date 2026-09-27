"""Additional features from public plans and telemetry observed no later than T."""
import numpy as np
import pandas as pd
from .features import seconds,PLAN_COLUMNS,TRAFFIC_COLUMNS

def enhanced_features(points,traffic,plan):
    tr=traffic[TRAFFIC_COLUMNS].copy();tr['_t']=seconds(tr.event_time)
    tr=tr.sort_values('_t',kind='stable')
    tr['valid']=tr.location_valid.astype(str).str.lower().eq('true') & tr.lon.between(36,39) & tr.lat.between(54,57)
    pl=plan[PLAN_COLUMNS].copy();pl['_t']=seconds(pl.time_begin)
    xy=pl.geom.str.extract(r'POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)').astype(float)
    pl['x']=(xy[0]-37.5)*62.5;pl['y']=(xy[1]-55.7)*111.2
    tg={k:g for k,g in tr.groupby('tr_id')};pg={k:g.sort_values('_t',kind='stable') for k,g in pl.groupby('tr_id')}
    out=[]
    for row in points.to_dict('records'):
        t=seconds(pd.Series([row['T']]))[0];p=pg[row['tr_id']];g=tg.get(row['tr_id'],tr.iloc[:0])
        times=g['_t'].to_numpy();end=np.searchsorted(times,t,side='right');start=np.searchsorted(times,t-5400)
        h=g.iloc[start:end];ht=h['_t'].to_numpy();speed=h.speed.to_numpy();spgood=np.isfinite(speed)&(speed>=0)&(speed<=160)
        valid=h.valid.to_numpy();gx=(h.lon.to_numpy()-37.5)*62.5;gy=(h.lat.to_numpy()-55.7)*111.2
        pt=p['_t'].to_numpy();pxy=p[['x','y']].to_numpy();dt=np.diff(pt);seg=pxy[1:]-pxy[:-1]
        lens=np.linalg.norm(seg,axis=1);cum=np.r_[0,np.cumsum(lens)]
        target_i=int(np.flatnonzero(p.tt_action_item_id.to_numpy()==row['target_stop_id'])[0])
        now_i=max(0,min(len(pt)-1,np.searchsorted(pt,t-row['cur_dev_s'],side='right')-1))
        txy=pxy[target_i];hour=(t%86400)/3600
        f={'ctx_hour':hour,'ctx_target_hour':(pt[target_i]%86400)/3600,
           'ctx_target_index':target_i,'ctx_target_fraction':target_i/max(1,len(pt)-1),
           'ctx_route_start_x':pxy[0,0],'ctx_route_start_y':pxy[0,1],
           'ctx_elapsed_service':t-pt[0],'ctx_to_service_end':pt[-1]-t,
           'ctx_now_plan_x':pxy[now_i,0],'ctx_now_plan_y':pxy[now_i,1],
           'ctx_stops_adjusted':target_i-now_i,'ctx_plan_path_km':cum[target_i]-cum[now_i],
           'ctx_plan_path_speed':(cum[target_i]-cum[now_i])/max(1,pt[target_i]-pt[now_i])*3600}
        for offset in [-3,-2,-1,1,2,3]:
            j=target_i+offset
            f[f'ctx_gap_{offset}']=pt[j]-pt[target_i] if 0<=j<len(pt) else np.nan
            f[f'ctx_dx_{offset}']=pxy[j,0]-txy[0] if 0<=j<len(pt) else np.nan
            f[f'ctx_dy_{offset}']=pxy[j,1]-txy[1] if 0<=j<len(pt) else np.nan
        breaks=np.flatnonzero(dt>900)
        before=breaks[breaks<target_i];after=breaks[breaks>=target_i]
        f['ctx_since_break']=pt[target_i]-pt[before[-1]+1] if len(before) else pt[target_i]-pt[0]
        f['ctx_to_break']=pt[after[0]]-pt[target_i] if len(after) else pt[-1]-pt[target_i]
        f['ctx_stops_since_break']=target_i-(before[-1]+1) if len(before) else target_i
        for window in [120,300,600,1200,1800,3600,5400]:
            sel=(ht>t-window);s=speed[sel&spgood];v=sel&valid
            f[f'motion_speed_q25_{window}']=np.quantile(s,.25) if len(s) else np.nan
            f[f'motion_speed_q75_{window}']=np.quantile(s,.75) if len(s) else np.nan
            f[f'motion_speed_median_{window}']=np.median(s) if len(s) else np.nan
            f[f'motion_moving_speed_{window}']=np.mean(s[s>3]) if np.any(s>3) else 0
            if v.sum()>=2:
                ix=np.flatnonzero(v);dd=np.hypot(np.diff(gx[ix]),np.diff(gy[ix]));elapsed=np.diff(ht[ix])
                usable=(elapsed>0)&(elapsed<120)&(dd/np.maximum(elapsed,1)<.05)
                f[f'motion_path_{window}']=dd[usable].sum()
                f[f'motion_displacement_{window}']=np.hypot(gx[ix[-1]]-gx[ix[0]],gy[ix[-1]]-gy[ix[0]])
                f[f'motion_dx_{window}']=gx[ix[-1]]-gx[ix[0]];f[f'motion_dy_{window}']=gy[ix[-1]]-gy[ix[0]]
            else:
                for nm in ['path','displacement','dx','dy']:f[f'motion_{nm}_{window}']=np.nan
        moving=np.flatnonzero(spgood&(speed>=3));good=np.flatnonzero(valid)
        f['motion_dwell']=t-ht[moving[-1]] if len(moving) else 5400
        f['motion_stale_gps']=t-ht[good[-1]] if len(good) else 5400
        if len(good):
            j=good[-1];lastxy=np.array([gx[j],gy[j]])
            f.update(motion_last_x=lastxy[0],motion_last_y=lastxy[1],
                     motion_target_dx=txy[0]-lastxy[0],motion_target_dy=txy[1]-lastxy[1])
            heading=np.deg2rad(h.heading.to_numpy()[j]);f['motion_heading_sin']=np.sin(heading);f['motion_heading_cos']=np.cos(heading)
            vector=txy-lastxy;f['motion_required_speed']=np.linalg.norm(vector)/(pt[target_i]-t)*3600
            f['motion_heading_alignment']=(vector[0]*np.sin(heading)+vector[1]*np.cos(heading))/(np.linalg.norm(vector)+1e-6)
        # Each map-matched observation is historical; no future GPS interpolation.
        grid=t-np.arange(19,-1,-1)*60
        gi=np.searchsorted(ht[valid],grid,side='right')-1
        if valid.sum() and len(pt)>1:
            vh=h[valid];vht=vh['_t'].to_numpy();vxy=np.column_stack([(vh.lon.to_numpy()-37.5)*62.5,(vh.lat.to_numpy()-55.7)*111.2])
            ix=np.maximum(gi,0);obs=vxy[ix];obs_t=vht[ix];ok=(gi>=0)&(grid-obs_t<180)
            frac=np.clip(((obs[:,None,:]-pxy[:-1])*seg).sum(2)/(lens**2+1e-8),0,1)
            projected=pxy[:-1]+frac[:,:,None]*seg
            dist=np.linalg.norm(obs[:,None,:]-projected,axis=2)
            dev=obs_t[:,None]-(pt[:-1]+frac*dt)
            headings=np.deg2rad(vh.heading.to_numpy()[ix]);dirxy=np.column_stack([np.sin(headings),np.cos(headings)])
            align=(dirxy[:,None,:]*seg).sum(2)/(lens+1e-6)
            for prior_name,prior in [('cur',row['cur_dev_s']),('zero',0)]:
                cost=dist+.0004*np.abs(dev-prior)+.10*(1-align)
                cost[(np.abs(dev-prior)>1800)|(dt[None]>900)]+=100
                jj=np.argmin(cost,axis=1);rr=np.arange(len(grid));mapped=np.clip(dev[rr,jj],-2400,2400)
                for n in [1,3,5,10,20]:
                    vals=mapped[-n:][ok[-n:]];ds=dist[rr,jj][-n:][ok[-n:]]
                    f[f'map_{prior_name}_delay_{n}']=np.median(vals) if len(vals) else np.nan
                    f[f'map_{prior_name}_std_{n}']=np.std(vals) if len(vals) else np.nan
                    f[f'map_{prior_name}_distance_{n}']=np.median(ds) if len(vals) else np.nan
                f[f'map_{prior_name}_trend']=mapped[-1]-mapped[-6] if ok[-1] and ok[-6] else np.nan
        out.append(f)
    return pd.DataFrame(out).replace([np.inf,-np.inf],np.nan)
