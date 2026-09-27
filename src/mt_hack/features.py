"""Shared offline/online features. Fact arrival columns are never read.

For every point, all telemetry comes from event_time <= T. Sequence bins are
right-closed; invalid GPS never becomes a valid zero coordinate.
"""
from pathlib import Path
import argparse
import json
import numpy as np
import pandas as pd

PLAN_COLUMNS = ['tt_action_item_id', 'tr_id', 'time_begin', 'geom']
TRAFFIC_COLUMNS = ['tr_id', 'event_time', 'location_valid', 'lon', 'lat', 'speed', 'heading']
SEQ_NAMES = ['speed_mean', 'speed_max', 'stopped_fraction', 'target_dx_km',
             'target_dy_km', 'count', 'gps_fraction', 'observed']


def seconds(values):
    return pd.to_datetime(values, format='mixed', utc=True).dt.tz_localize(None).astype('datetime64[ns]').astype('int64').to_numpy() / 1e9


def load_split(root, split):
    root = Path(root)
    labels = root / ('validate/points.csv' if split == 'validate' else f'labels/labels_{split}.csv')
    points = pd.read_csv(labels)
    traffic = pd.read_csv(root / split / 'traffic.csv', usecols=TRAFFIC_COLUMNS)
    plan = pd.read_csv(root / split / ('schedule_plan.csv' if split == 'validate' else 'schedule.csv'), usecols=PLAN_COLUMNS)
    return points, traffic, plan


def build_features(points, traffic, plan, sequence_bins=30, *, include_sequence=True):
    """Return numeric features and optional GRU tensors; tree inference skips unused bins."""
    p = points.copy()
    p['_t'] = seconds(p['T'])
    p['_target_t'] = seconds(p.target_time_begin)
    horizons = p['_target_t'] - p['_t']
    if not ((horizons > 600) & (horizons <= 900)).all():
        raise ValueError('Every target must lie in (T+600s, T+900s].')
    tr = traffic[TRAFFIC_COLUMNS].copy()
    tr['_t'] = seconds(tr.event_time)
    tr = tr.sort_values(['tr_id', '_t'], kind='stable')
    tr['valid'] = tr.location_valid.astype(str).str.lower().eq('true') & tr.lon.between(-180,180) & tr.lat.between(-90,90)
    tr.loc[~tr.valid, ['lon', 'lat']] = np.nan
    tr.loc[~tr.speed.between(0,160), 'speed'] = np.nan
    plan = plan[PLAN_COLUMNS].copy()
    plan['_t'] = seconds(plan.time_begin)
    coords = plan.geom.str.extract(r'POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)').astype(float)
    plan['lon'], plan['lat'] = coords[0], coords[1]
    stop_lookup = plan.drop_duplicates(['tr_id','tt_action_item_id']).set_index(['tr_id','tt_action_item_id'])
    tg = {k: g for k,g in tr.groupby('tr_id',sort=False)}
    pg = {k: g.sort_values('_t') for k,g in plan.groupby('tr_id',sort=False)}
    records, sequences = [], []
    for row in p.to_dict('records'):
        t, tid = row['_t'], row['tr_id']
        target = stop_lookup.loc[(tid,row['target_stop_id'])] if (tid,row['target_stop_id']) in stop_lookup.index else None
        tx, ty = (float(target.lon),float(target.lat)) if target is not None else (np.nan,np.nan)
        horizon = row['_target_t']-t
        hour = (t % 86400) / 3600
        f = {'cur_dev_s':row['cur_dev_s'], 'horizon_s':horizon,
             'hour_sin':np.sin(hour*np.pi/12), 'hour_cos':np.cos(hour*np.pi/12),
             'target_lon':tx, 'target_lat':ty}
        g = tg.get(tid)
        if g is None:
            hist = tr.iloc[:0]
        else:
            times = g['_t'].to_numpy()
            hist = g.iloc[np.searchsorted(times,t-1800,side='right'):np.searchsorted(times,t,side='right')]
        valid = hist[hist.valid]
        f['telemetry_age_s'] = t-hist['_t'].iloc[-1] if len(hist) else 3600.
        f['gps_age_s'] = t-valid['_t'].iloc[-1] if len(valid) else 3600.
        f['last_speed'] = hist.speed.dropna().iloc[-1] if hist.speed.notna().any() else np.nan
        f['target_distance_km'] = float(np.hypot((valid.lon.iloc[-1]-tx)*62.5,(valid.lat.iloc[-1]-ty)*111.2)) if len(valid) else np.nan
        for window in [60,180,300,600,900,1800]:
            h=hist[hist['_t']>t-window]
            speed=h.speed.dropna()
            f.update({f'count_{window}':len(h), f'valid_frac_{window}':h.valid.mean(),
                f'speed_mean_{window}':speed.mean(),f'speed_std_{window}':speed.std(ddof=0),
                f'speed_max_{window}':speed.max(),f'stop_frac_{window}':(speed<2).mean() if len(speed) else np.nan})
        if tid in pg:
            pl = pg[tid]
            ts=pl['_t'].to_numpy()
            i=np.searchsorted(ts,row['_target_t'])
            f['target_prev_gap_s']=ts[i]-ts[i-1] if 0<i<len(ts) else np.nan
            f['planned_stops_ahead']=int(((ts>t)&(ts<=row['_target_t'])).sum())
            near=pl[np.abs(ts-(t-row['cur_dev_s']))<=1800]
            if len(near) and len(valid):
                distances=np.hypot((near.lon.to_numpy()-valid.lon.iloc[-1])*62.5,(near.lat.to_numpy()-valid.lat.iloc[-1])*111.2)
                j=int(np.nanargmin(distances))
                f['nearest_plan_distance_km']=distances[j]
                f['position_delay_proxy_s']=t-near['_t'].iloc[j]
            else:
                f['nearest_plan_distance_km']=np.nan; f['position_delay_proxy_s']=np.nan
        else:
            f.update(target_prev_gap_s=np.nan,planned_stops_ahead=0,nearest_plan_distance_km=np.nan,position_delay_proxy_s=np.nan)
        seq=np.zeros((sequence_bins,len(SEQ_NAMES)),dtype=np.float32)
        # Each bin ends at T-870,...,T: never use a later observation.
        for j,end in enumerate(t-np.arange(sequence_bins-1,-1,-1)*30 if include_sequence else []):
            h=hist[(hist['_t']>end-30)&(hist['_t']<=end)]
            if not len(h): continue
            s=h.speed.dropna(); v=h[h.valid]
            seq[j]=[s.mean()/50 if len(s) else 0,s.max()/80 if len(s) else 0,
                    (s<2).mean() if len(s) else 0,
                    np.clip((v.lon.mean()-tx)*62.5/10,-5,5) if len(v) and np.isfinite(tx) else 0,
                    np.clip((v.lat.mean()-ty)*111.2/10,-5,5) if len(v) and np.isfinite(ty) else 0,
                    min(len(h)/10,5), h.valid.mean(), 1]
        records.append(f);sequences.append(seq)
    return pd.DataFrame(records), np.nan_to_num(np.stack(sequences)).astype(np.float32)


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--data',default='data/raw');ap.add_argument('--out',default='data/features');args=ap.parse_args()
    out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
    for split in ['train','test','validate']:
        points,traffic,plan=load_split(args.data,split)
        x,s=build_features(points,traffic,plan)
        x.to_parquet(out/f'{split}.parquet',index=False)
        points.to_parquet(out/f'{split}_points.parquet',index=False)
        np.save(out/f'{split}_sequence.npy',s)
        print(f'{split}: {len(x)} rows, {x.shape[1]} features, sequence {s.shape}',flush=True)
    (out/'schema.json').write_text(json.dumps({'numeric':list(x),'sequence':SEQ_NAMES},indent=2))
if __name__=='__main__':main()
