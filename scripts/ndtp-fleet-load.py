"""Synthetic fleet load using the official NDTP 6.2 wire format, not model accuracy.

prepare creates a current synthetic plan; feed sends moving/stopping vehicles
and optionally pauses one vehicle long enough for GPS freshness to expire.
This generator is independent of the organizers' Docker emulator. Both paths
use the production binary receiver, feature extractor and trained model.
"""
import argparse
import asyncio
import csv
import json
import math
import struct
import time
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ml"))
from transit_ml.ndtp import crc16


def frame(unit, timestamp, lon, lat, speed):
    nav = bytes([0, 0]) + struct.pack("<IIIBBHHHHHBB", int(timestamp), round(lon * 1e7),
        round(lat * 1e7), 224, 100, speed, speed, 90, 0, 150, 8, 1)
    body = struct.pack("<HHHI", 1, 101, 1, 1) + nav
    return struct.pack("<HHHHBIH", 0x7E7E, len(body), 0, crc16(body), 2, unit, 0) + body


def position(config, vehicle, at):
    # 15 seconds dwelling, then a 250 m segment. Delays vary across vehicles.
    phase = (at - config["firstPlannedAt"] - (vehicle % 4) * 60) / 180
    index = math.floor(phase)
    elapsed = (phase - index) * 180
    progress = max(0, (elapsed - 15) / 165)
    return 37.55 + (index + progress) * .004, 55.70 + vehicle * .0003, 0 if elapsed <= 15 else 6


def prepare(args):
    args.plan.mkdir(parents=True, exist_ok=True)
    base = int(time.time())
    config = {"synthetic": True, "vehicles": args.vehicles, "intervalSec": args.interval,
              "createdAt": base, "firstPlannedAt": base - 2400}
    (args.plan / "load-config.json").write_text(json.dumps(config, indent=2))
    (args.plan / "unit-map.json").write_text(json.dumps({str(700000+i): 900000+i for i in range(args.vehicles)}))
    with (args.plan / "schedule_plan.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["tt_action_item_id", "tr_id", "time_begin", "geom", "building_address"])
        for i in range(args.vehicles):
            for stop in range(70):
                planned = config["firstPlannedAt"] + stop * 180
                writer.writerow([800000000+i*1000+stop, 900000+i,
                    datetime.fromtimestamp(planned, timezone.utc).isoformat(),
                    f"POINT ({37.55+stop*.004:.7f} {55.70+i*.0003:.7f})",
                    f"Нагрузочный стенд · ТС {i+1} · остановка {stop+1}"])
    print(json.dumps(config), flush=True)


async def feed(args):
    config = json.loads((args.plan / "load-config.json").read_text())
    _, writer = await asyncio.open_connection(args.host, args.port)
    sent = 0
    warm_end = int(time.time())
    if args.warm_history:
        for at in range(warm_end - args.warm_history, warm_end, config["intervalSec"]):
            writer.write(b"".join(frame(700000+i, at, *position(config, i, at)) for i in range(config["vehicles"])))
            sent += config["vehicles"]
            await writer.drain()
        print(json.dumps({"warmHistoryFrames": sent, "warmHistorySec": args.warm_history}), flush=True)
    start = time.monotonic()
    tick = 0
    reconnected = False
    try:
        while time.monotonic() - start < args.seconds:
            at = int(time.time())
            elapsed = time.monotonic() - start
            if not reconnected and elapsed >= args.reconnect_at:
                writer.close()
                await writer.wait_closed()
                await asyncio.sleep(2)
                _, writer = await asyncio.open_connection(args.host, args.port)
                reconnected = True
                print(json.dumps({"tcpReconnectedAtSec": round(time.monotonic()-start)}), flush=True)
            packets = [frame(700000+i, at, *position(config, i, at)) for i in range(config["vehicles"])
                       if not (i == 0 and args.pause_at <= elapsed < args.pause_at + args.pause_seconds)]
            writer.write(b"".join(packets))
            await writer.drain()
            sent += len(packets)
            tick += 1
            if tick % 12 == 0:
                print(json.dumps({"elapsedSec": round(elapsed), "sent": sent, "pausedVehicle":
                    args.pause_at <= elapsed < args.pause_at + args.pause_seconds}), flush=True)
            await asyncio.sleep(max(0, start + tick * config["intervalSec"] - time.monotonic()))
    finally:
        writer.close()
        await writer.wait_closed()
    print(json.dumps({"complete": True, "elapsedSec": round(time.monotonic()-start), "sent": sent}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "feed"])
    parser.add_argument("--plan", type=Path, default=Path("docker/local-data/fleet-load"))
    parser.add_argument("--vehicles", type=int, default=100)
    parser.add_argument("--interval", type=int, default=5)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9201)
    parser.add_argument("--seconds", type=int, default=2100)
    parser.add_argument("--warm-history", type=int, default=1800)
    parser.add_argument("--pause-at", type=int, default=600)
    parser.add_argument("--pause-seconds", type=int, default=210)
    parser.add_argument("--reconnect-at", type=int, default=1200)
    args = parser.parse_args()
    if not 1 <= args.vehicles <= 1000 or not 1 <= args.interval <= 60 or not 0 <= args.warm_history <= 1800:
        parser.error("vehicles 1..1000, interval 1..60, warm-history 0..1800 required")
    if args.action == "prepare": prepare(args)
    else: asyncio.run(feed(args))
