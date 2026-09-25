"""Reproducible synthetic fixtures; OSM geometry, invented schedules and telemetry."""
import csv, json, math
from datetime import datetime, timedelta, timezone
from pathlib import Path
root = Path(__file__).resolve().parents[1]
catalog = json.loads((root / 'src/data/moscow-buses.json').read_text())
out = root / 'admin/csv/example'
out.mkdir(parents=True, exist_ok=True)
base = datetime(2026, 9, 23, 7, 0, tzinfo=timezone.utc)
iso = lambda dt: dt.isoformat().replace('+00:00', 'Z')
tables = {k: [] for k in ['routes', 'stops', 'schedule', 'telemetry', 'shapes']}
stops = {}
for i, route in enumerate(catalog['routes']):
    rid = route['id']
    tables['routes'].append(dict(route_id=rid, route_number=route['number'], route_name=route['name']))
    for s in route['stops']:
        stops[s['id']] = dict(stop_id=s['id'], stop_name=s['name'], lat=s['position']['lat'], lon=s['position']['lon'])
    coords = route['coordinates']
    distances = [0]
    for a, b in zip(coords, coords[1:]):
        distances.append(distances[-1] + math.hypot((b[0]-a[0])*math.cos(math.radians((a[1]+b[1])/2)), b[1]-a[1])*111195)
    for seq, (lon, lat) in enumerate(coords, 1):
        tables['shapes'].append(dict(route_id=rid, point_sequence=seq, lat=lat, lon=lon))
    for j in range(8):
        vid = 'vehicle-742' if i == 0 and j == 0 else f'vehicle-{800+i*10+j}'
        tid = f'{rid}-20260923-{j:03d}'
        start = base - timedelta(seconds=j*210)
        schedule = []
        for k, s in enumerate(route['stops']):
            arrival = start + timedelta(seconds=round(s['distanceM']/8) + k*30)
            departure = arrival + timedelta(seconds=30)
            schedule.append((arrival, departure, s))
            tables['schedule'].append(dict(trip_id=tid, vehicle_id=vid, route_id=rid, stop_id=s['id'], stop_sequence=k+1, arrival_time=iso(arrival), departure_time=iso(departure)))
        for minute in range(31):
            now = base + timedelta(minutes=minute)
            delay = round(60 + minute*9) if i == 0 and j in [0, 3, 4] else (180 if i == 1 and j in [3, 4, 5] else (-20 if j == 7 else 15))
            planned = now - timedelta(seconds=delay)
            speed = 28.8
            target = 0
            next_stop = schedule[0][2]
            for k, (arrival, departure, stop) in enumerate(schedule):
                next_stop = stop
                if planned <= departure:
                    if planned >= arrival or k == 0:
                        target, speed = stop['distanceM'], 0
                    else:
                        speed = 28.8
                        previous = schedule[k-1]
                        f = max(0, min(1, (planned-previous[1]).total_seconds()/(arrival-previous[1]).total_seconds()))
                        target = previous[2]['distanceM'] + f*(stop['distanceM']-previous[2]['distanceM'])
                    break
                target, speed = stop['distanceM'], 0
            idx = next((n for n in range(1,len(distances)) if distances[n]>=target), len(distances)-1)
            f = min(1,max(0,(target-distances[idx-1])/(distances[idx]-distances[idx-1] or 1)))
            a,b = coords[idx-1],coords[idx]
            tables['telemetry'].append(dict(timestamp=iso(now), trip_id=tid, vehicle_id=vid, lat=round(a[1]+(b[1]-a[1])*f,7), lon=round(a[0]+(b[0]-a[0])*f,7), speed=speed, delay=delay, next_stop_id=next_stop['id']))
tables['stops'] = list(stops.values())
profile = dict(label='Учебный автобусный поток · синтетические данные', encoding='utf8', delimiter=',', decimal='.', time=dict(schedule='iso', telemetry='iso', utcOffset='+03:00'), units=dict(speed='kmh', delay='seconds'), tables={})
for name, rows in tables.items():
    headers = list(rows[0])
    with (out / f'{name}.csv').open('w', encoding='utf-8-sig', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=headers)
        writer.writeheader(); writer.writerows(rows)
    profile['tables'][name] = dict(file=f'{name}.csv', columns={h:h for h in headers})
(root / 'admin/csv/profiles/default.json').write_text(json.dumps(profile,ensure_ascii=False,indent=2)+'\n')
print({name:len(rows) for name,rows in tables.items()})
# Alternative input convention: Russian headers, semicolon, decimal comma, epoch ms,
# speed in m/s and delay in minutes. It produces the same normalized data.
import copy
ru = copy.deepcopy(profile)
ru['units'] = dict(speed='mps', delay='minutes')
ru['time']['telemetry'] = 'unix_ms'
ru['decimal'] = ','
columns = dict(timestamp='время_ms', trip_id='рейс', vehicle_id='автобус', lat='широта', lon='долгота', speed='скорость_мс', delay='задержка_мин', next_stop_id='следующая_остановка')
ru['tables']['telemetry'] = dict(file='telemetry-ru.csv', delimiter=';', columns=columns)
with (out / 'telemetry-ru.csv').open('w', encoding='utf-8-sig', newline='') as file:
    writer = csv.DictWriter(file, fieldnames=list(columns.values()), delimiter=';')
    writer.writeheader()
    for r in tables['telemetry']:
        values = dict(r, timestamp=str(round(datetime.fromisoformat(r['timestamp'].replace('Z','+00:00')).timestamp()*1000)), speed=r['speed']/3.6, delay=r['delay']/60)
        writer.writerow({label:str(values[key]).replace('.',',') if key in ['lat','lon','speed','delay'] else values[key] for key,label in columns.items()})
(root / 'admin/csv/profiles/russian.json').write_text(json.dumps(ru,ensure_ascii=False,indent=2)+'\n')
