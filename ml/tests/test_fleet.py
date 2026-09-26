"""Fleet visibility is independent of schedule, forecast targets and GPS freshness."""
import asyncio
import json
from collections import deque

import httpx
import pandas as pd
import pytest

from transit_ml.backend import Engine, app, status

T = pd.Timestamp("2026-01-06T17:50:00Z")


def reply(request):
    body = json.loads(request.content)
    return httpx.Response(200, json={
        "asOf": body["asOf"], "latencyMs": 1,
        "predictions": [{"vehicleId": p["vehicleId"], "delaySec": 123,
                         "lateProbability": .7} for p in body["items"]],
    })


@pytest.fixture
def fleet(tmp_path, monkeypatch):
    folder = tmp_path / "test"
    folder.mkdir()
    # 1 can predict; 2 no target in horizon; 3 no schedule; 4 stale >30min;
    # 5 future-only GPS; 6 invalid GPS; 7 no observed delay yet.
    rows = []
    for tr, offset in [(1, -5), (2, -8), (3, -9), (4, -2400), (5, 60), (6, -5), (7, -2)]:
        rows.append(dict(tr_id=tr, unit_id=tr, event_time=(T + pd.Timedelta(seconds=offset)).isoformat(),
                         location_valid=tr != 6, lon=37.63, lat=55.75, speed=20, heading=90))
    rows.append({**rows[0], "event_time": (T - pd.Timedelta(seconds=50)).isoformat(), "lon": 37.629})
    rows.append({**rows[0], "event_time": (T + pd.Timedelta(seconds=50)).isoformat(), "lon": 37.632})
    # Later invalid GPS must not replace a valid last position.
    rows.append({**rows[0], "event_time": (T - pd.Timedelta(seconds=1)).isoformat(), "location_valid": False})
    pd.DataFrame(rows).to_csv(folder / "traffic.csv", index=False)
    plans = []
    for tr in [1, 2, 4, 5, 6, 7]:
        offsets = [300] if tr == 2 else [720]
        if tr == 1:
            offsets.insert(0, -240)
        for offset in offsets:
            plans.append(dict(tr_id=tr, tt_action_item_id=len(plans) + 100,
                              time_begin=(T + pd.Timedelta(seconds=offset)).isoformat(),
                              time_fact_begin=(T + pd.Timedelta(seconds=offset + 20)).isoformat(),
                              geom="POINT (37.64 55.76)", building_address="Остановка"))
    pd.DataFrame(plans).to_csv(folder / "schedule.csv", index=False)
    monkeypatch.setenv("OFFICIAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("REPLAY_START", "2026-01-06 17:50:00")
    monkeypatch.setenv("REPLAY_SPEED", "0")
    monkeypatch.setenv("TELEMETRY_MODE", "replay")
    return Engine()


def snapshot(engine, handler=reply):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            engine.client = client
            engine.cache_at = 0
            return await engine.snapshot()
    return asyncio.run(run())


def test_all_known_positions_survive_missing_plan_target_and_long_outage(fleet):
    requests = []
    def model(request):
        requests.append(json.loads(request.content))
        return reply(request)
    s = snapshot(fleet, model)
    v = {v['id']: v for v in s['vehicles']}
    assert set(v) == {f'vehicle-{tr}' for tr in [1, 2, 3, 4, 7]}
    assert len(s['routes']) == len(s['geometries']) == 5
    trace = next(g for g in s['geometries'] if g['properties']['route_id'] == 'duty-1')
    assert trace['properties']['observed_paths'] == [[[37.629, 55.75], [37.63, 55.75]]]
    assert [37.632, 55.75] not in trace['geometry']['coordinates']
    assert v['vehicle-2']['forecast_status'] == 'no_target'
    assert v['vehicle-3']['forecast_status'] == 'no_schedule'
    assert v['vehicle-4']['status'] == 'stale'
    assert v['vehicle-4']['telemetry_age_sec'] == 2400
    for tr in [2, 3, 4]:
        assert v[f'vehicle-{tr}']['predicted_delay_sec'] is None
        assert v[f'vehicle-{tr}']['risk_level'] == 'unknown'
    assert {p['vehicleId'] for p in requests[0]['items']} == {'vehicle-1', 'vehicle-7'}
    assert v['vehicle-1']['telemetry_age_sec'] == 5
    assert v['vehicle-1']['current_delay_sec'] == 20
    assert v['vehicle-7']['current_delay_sec'] is None  # no future actual arrival leakage
    assert s['summary']['vehicles_located'] == 5
    assert s['summary']['vehicles_active'] == 4
    assert s['summary']['vehicles_predicted'] == 2
    assert s['summary']['vehicles_assessed'] == 1
    assert s['summary']['vehicles_total'] == 7
    assert s['summary']['vehicles_without_position'] == 2


def test_outage_and_recovery_do_not_remove_buses_or_invent_predictions(fleet):
    def failed(request):
        raise httpx.ConnectError('offline', request=request)
    s = snapshot(fleet, failed)
    assert len(s['vehicles']) == 5
    assert s['summary']['vehicles_predicted'] == 1
    assert next(v for v in s['vehicles'] if v['id'] == 'vehicle-7')['predicted_delay_sec'] is None
    recovered = snapshot(fleet)
    assert len(recovered['vehicles']) == 5
    assert recovered['summary']['vehicles_predicted'] == 2


def test_ndtp_loss_keeps_last_position_and_new_packet_recovers(fleet, monkeypatch):
    fleet.mode = 'ndtp'
    monkeypatch.setattr('transit_ml.backend.time.time', lambda: T.timestamp())
    row = dict(ts=T.timestamp() - 181, lat=55.75, lon=37.63,
               location_valid=True, speed=20, heading=90)
    fleet.receiver.histories[1] = deque([row], maxlen=1500)
    s = snapshot(fleet)
    assert len(s['vehicles']) == 1 and s['vehicles'][0]['status'] == 'stale'
    assert s['vehicles'][0]['forecast_status'] == 'stale_gps'
    fleet.receiver.histories[1].append({**row, 'ts': T.timestamp(), 'lon': 37.64})
    s = snapshot(fleet)
    assert s['vehicles'][0]['status'] == 'active'
    assert s['vehicles'][0]['forecast_status'] == 'ready'
    assert s['vehicles'][0]['position']['lon'] == 37.64


def test_ndtp_indexes_shared_route_and_sends_only_recent_model_history(fleet, monkeypatch):
    fleet.mode = 'ndtp'
    fleet.unit_map[101] = 1
    monkeypatch.setattr('transit_ml.backend.time.time', lambda: T.timestamp())
    row = dict(lat=55.75, lon=37.63, location_valid=True,
               speed=20, heading=90)
    fleet.receiver.histories[1] = deque([
        {**row, 'ts': T.timestamp() - 3600},
        {**row, 'ts': T.timestamp() - 20},
    ], maxlen=1500)
    fleet.receiver.histories[101] = deque([
        {**row, 'ts': T.timestamp() - 10, 'lon': 37.631},
    ], maxlen=1500)
    fleet.receiver.histories[999] = deque([
        {**row, 'ts': T.timestamp()},
    ], maxlen=1500)
    requests = []
    def model(request):
        requests.append(json.loads(request.content))
        return reply(request)
    result = snapshot(fleet, model)
    item = requests[0]['items'][0]
    assert len(result['vehicles']) == 1
    assert item['vehicleId'] == 'vehicle-1'
    assert [pd.Timestamp(point['event_time']).timestamp()
            for point in item['telemetry']] == [T.timestamp() - 20, T.timestamp() - 10]
    assert result['vehicles'][0]['position']['lon'] == 37.631


def test_target_window_closes_but_vehicle_remains(fleet):
    before = snapshot(fleet)
    assert next(v for v in before['vehicles'] if v['id'] == 'vehicle-1')['forecast_status'] == 'ready'
    # Move plan out of prediction horizon, preserving its actual next arrival.
    fleet.plans[1].loc[fleet.plans[1].ts > T.timestamp(), 'ts'] = T.timestamp() + 599
    after = snapshot(fleet)
    vehicle = next(v for v in after['vehicles'] if v['id'] == 'vehicle-1')
    assert vehicle['forecast_status'] == 'no_target'
    assert vehicle['forecast_horizon_sec'] is None
    assert vehicle['predicted_delay_sec'] is None
    assert len(after['vehicles']) == len(before['vehicles'])


@pytest.mark.parametrize('seconds,expected', [(600, False), (601, True),
                                               (900, True), (901, False)])
def test_backend_uses_strict_horizon_edges(fleet, seconds, expected):
    future = fleet.plans[1].ts > T.timestamp()
    target_id = int(fleet.plans[1].loc[future, 'tt_action_item_id'].iloc[0])
    target_time = (T + pd.Timedelta(seconds=seconds)).isoformat()
    fleet.plans[1].loc[future, ['ts', 'time_begin']] = [T.timestamp() + seconds, target_time]
    fleet.dataset.stops[target_id]['ts'] = T.timestamp() + seconds
    fleet.dataset.stops[target_id]['time_begin'] = target_time
    result = snapshot(fleet)
    vehicle = next(v for v in result['vehicles'] if v['id'] == 'vehicle-1')
    assert (vehicle['forecast_status'] == 'ready') is expected
    assert (vehicle['forecast_horizon_sec'] == seconds) is expected


def test_warning_is_first_published_in_window_and_never_backdated(fleet):
    first = snapshot(fleet)
    warning = next(a for a in first['alerts'] if a['vehicle_id'] == 'vehicle-1')
    assert warning['created_at'] == T.isoformat().replace('+00:00', 'Z')
    assert warning['lead_time_sec'] == 720
    assert warning['target_time'] == (T + pd.Timedelta(seconds=720)).isoformat().replace('+00:00', 'Z')
    assert warning['expected_arrival_at'] == (T + pd.Timedelta(seconds=843)).isoformat().replace('+00:00', 'Z')
    assert warning['observed_factor']
    assert len(fleet.warning_audit) == len(first['alerts'])

    # Recalculation is not a new alert, even though its remaining horizon changes.
    fleet.start += 30
    second = snapshot(fleet)
    updated = next(a for a in second['alerts'] if a['id'] == warning['id'])
    assert updated['created_at'] == warning['created_at']
    assert updated['lead_time_sec'] == 720
    assert len(fleet.warning_audit) == len(first['alerts'])

    # At T+121 the planned target is only 599 s away: no retrospective alert.
    fleet.dataset.traffic.loc[fleet.dataset.traffic.index[-1], 'ts'] = T.timestamp() + 200
    fleet.start += 91
    late = snapshot(fleet)
    assert warning['id'] not in {a['id'] for a in late['alerts']}
    assert all(600 < a['lead_time_sec'] <= 900 for a in late['alerts'])


def test_classifier_warning_is_visible_in_route_attention_list(fleet):
    def uncertain_late(request):
        body = json.loads(request.content)
        return httpx.Response(200, json={
            "asOf": body["asOf"], "latencyMs": 1,
            "predictions": [{"vehicleId": item["vehicleId"], "delaySec": 105,
                             "lateProbability": .67} for item in body["items"]],
        })

    s = snapshot(fleet, uncertain_late)
    warned_ids = {alert["route_id"] for alert in s["alerts"]}
    assert warned_ids
    assert all(route["risk_level"] == "elevated"
               for route in s["routes"] if route["id"] in warned_ids)
    assert s["summary"]["at_risk_percent"] == 100
    assert s["summary"]["on_time_percent"] == 0


def test_early_actual_arrival_is_not_forecast_after_event(fleet):
    # A pathological >10-minute early arrival remains causally visible at T.
    # The plan is in the horizon, but the event has already happened.
    target_id = fleet.plans[1].loc[fleet.plans[1].ts > T.timestamp(), 'tt_action_item_id'].iloc[0]
    actual = fleet.actual[1]
    actual.loc[actual.tt_action_item_id.eq(target_id), 'actual_ts'] = T.timestamp() - 5
    s = snapshot(fleet)
    v = next(v for v in s['vehicles'] if v['id'] == 'vehicle-1')
    assert v['forecast_status'] == 'no_target'
    assert not any(a['vehicle_id'] == 'vehicle-1' for a in s['alerts'])


def test_live_ndtp_delayed_packet_and_observed_arrival_do_not_reissue_warning(fleet, monkeypatch):
    fleet.mode = 'ndtp'
    clock = [T.timestamp()]
    monkeypatch.setattr('transit_ml.backend.time.time', lambda: clock[0])
    row = dict(ts=T.timestamp() - 181, lat=55.75, lon=37.63,
               location_valid=True, speed=20, heading=90)
    fleet.receiver.histories[1] = deque([row], maxlen=1500)
    missing = snapshot(fleet)
    assert not any(a['vehicle_id'] == 'vehicle-1' for a in missing['alerts'])

    fleet.receiver.histories[1].append({**row, 'ts': clock[0]})
    issued = snapshot(fleet)
    warning = next(a for a in issued['alerts'] if a['vehicle_id'] == 'vehicle-1')
    assert warning['lead_time_sec'] == 720
    assert warning['model_status'] == 'ready'

    # The bus reaches the target stop unusually early. A later-arriving old
    # packet must not create a new forecast for an already observed event.
    clock[0] += 30
    fleet.receiver.histories[1].append({**row, 'ts': clock[0], 'lon': 37.64,
                                        'lat': 55.76, 'speed': 0})
    reached = snapshot(fleet)
    assert not any(a['vehicle_id'] == 'vehicle-1' for a in reached['alerts'])
    assert len([a for a in fleet.warning_audit if a['vehicle_id'] == 'vehicle-1']) == 1
    clock[0] += 700
    fleet.receiver.histories[1].append({**row, 'ts': T.timestamp() + 10})
    delayed = snapshot(fleet)
    assert not any(a['vehicle_id'] == 'vehicle-1' for a in delayed['alerts'])


def test_ndtp_packet_publishes_warning_without_ui_poll(fleet, monkeypatch):
    fleet.mode = 'ndtp'
    monkeypatch.setattr('transit_ml.backend.time.time', lambda: T.timestamp())
    row = dict(unit_id=1, ts=T.timestamp(), lat=55.75, lon=37.63,
               location_valid=True, speed=20, heading=90)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as client:
            fleet.client = client
            worker = asyncio.create_task(fleet.stream_forecasts())
            try:
                fleet.receiver.histories[1] = deque([row], maxlen=1500)
                fleet._on_packet(row)
                for _ in range(50):
                    if any(a['vehicle_id'] == 'vehicle-1' for a in fleet.warning_audit):
                        break
                    await asyncio.sleep(.02)
                assert any(a['vehicle_id'] == 'vehicle-1' for a in fleet.warning_audit)
                assert fleet.cache['alerts'][0]['created_at'] == T.isoformat().replace('+00:00', 'Z')
            finally:
                worker.cancel()
                try:
                    await worker
                except asyncio.CancelledError:
                    pass

    asyncio.run(run())


def test_ndtp_status_counts_unmapped_packets_and_bounded_latency(fleet, monkeypatch):
    fleet.mode = 'ndtp'
    monkeypatch.setattr('transit_ml.backend.time.time', lambda: T.timestamp())
    unknown = dict(unit_id=999, ts=T.timestamp(), lat=55.75, lon=37.63,
                   location_valid=True, speed=20, heading=90)
    fleet._on_packet(unknown)
    assert fleet.unmapped_packets == 1
    assert not fleet.packet_event.is_set()
    fleet.receiver.histories[999] = deque([unknown], maxlen=1500)
    fleet._on_packet({**unknown, 'unit_id': 1})
    fleet._on_packet({**unknown, 'unit_id': 1})
    assert fleet.mapped_packets == 2 and fleet.coalesced_packets == 1
    assert fleet.packet_event.is_set()
    snapshot(fleet)
    app.state.engine = fleet
    report = asyncio.run(status())
    assert report['ndtp']['unmappedPackets'] == 1
    assert report['ndtp']['forecastPending']
    assert report['pipelineLatencyMs']['samples'] == 1
    assert report['pipelineLatencyMs']['p95'] >= 0


def test_ndtp_requires_current_plan(monkeypatch, tmp_path):
    monkeypatch.setenv('TELEMETRY_MODE', 'ndtp')
    monkeypatch.delenv('LIVE_PLAN_DIR', raising=False)
    monkeypatch.setenv('OFFICIAL_DATA_DIR', str(tmp_path))
    with pytest.raises(ValueError, match='LIVE_PLAN_DIR'):
        Engine()


def test_ndtp_tcp_frame_reaches_forecast_and_warning(fleet, monkeypatch):
    import struct
    from transit_ml.ndtp import crc16

    fleet.mode = 'ndtp'
    monkeypatch.setattr('transit_ml.backend.time.time', lambda: T.timestamp())
    payload = (
        struct.pack('<HHHI', 1, 101, 1, 1)
        + bytes([0, 0])
        + struct.pack('<IIIBBHHHHHBB', int(T.timestamp()), 376300000,
                      557500000, 224, 100, 20, 35, 90, 100, 150, 8, 1)
    )
    frame = struct.pack('<HHHHBIH', 0x7E7E, len(payload), 0,
                        crc16(payload), 2, 1, 0) + payload

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as client:
            fleet.client = client
            worker = asyncio.create_task(fleet.stream_forecasts())
            server = await asyncio.start_server(fleet.receiver.handle, '127.0.0.1', 0)
            try:
                async with server:
                    _, writer = await asyncio.open_connection(
                        '127.0.0.1', server.sockets[0].getsockname()[1]
                    )
                    writer.write(frame[:7])
                    await writer.drain()
                    writer.write(frame[7:])
                    await writer.drain()
                    for _ in range(50):
                        if fleet.warning_audit:
                            break
                        await asyncio.sleep(.02)
                    writer.close()
                    await writer.wait_closed()
                    assert fleet.receiver.frames == 1
                    assert fleet.warning_audit[0]['lead_time_sec'] == 720
                    assert fleet.cache['alerts'][0]['model_status'] == 'ready'
            finally:
                worker.cancel()
                try:
                    await worker
                except asyncio.CancelledError:
                    pass

    asyncio.run(run())


def test_larger_feed_is_not_limited_by_number_of_plans(fleet):
    path = fleet.root / "test/traffic.csv"
    data = pd.read_csv(path)
    template = data[data.tr_id.eq(3)].iloc[0].to_dict()
    extra = pd.DataFrame([{**template, "tr_id": tr, "unit_id": tr} for tr in range(1000, 1120)])
    pd.concat([data, extra]).to_csv(path, index=False)
    s = snapshot(Engine())
    assert s["summary"]["vehicles_located"] == 125
    assert s["summary"]["vehicles_active"] == 124
    assert s["summary"]["vehicles_predicted"] == 2
    assert len({v["id"] for v in s["vehicles"]}) == 125


def test_gps_sections_split_long_gaps_and_position_jumps():
    from transit_ml.backend import observed_paths
    data = pd.DataFrame([
        dict(ts=1000, lon=37.6, lat=55.7),
        dict(ts=1010, lon=37.601, lat=55.7),
        dict(ts=1020, lon=37.601, lat=55.7),
        dict(ts=2000, lon=37.602, lat=55.7),
        dict(ts=2010, lon=37.603, lat=55.7),
        dict(ts=2020, lon=39.0, lat=55.7),  # impossible GPS teleport
        dict(ts=2030, lon=39.001, lat=55.7),
        dict(ts=3000, lon=39.002, lat=55.7),  # not yet observed
    ])
    assert observed_paths(data, 2500) == [
        [[37.6, 55.7], [37.601, 55.7]],
        [[37.602, 55.7], [37.603, 55.7]],
        [[39.0, 55.7], [39.001, 55.7]],
    ]
