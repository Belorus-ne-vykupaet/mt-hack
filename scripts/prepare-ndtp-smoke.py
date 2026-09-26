"""Create a clearly synthetic *current* plan for the official NDTP emulator smoke test.

This fixture proves binary transport and service integration. It is not a
replacement for an operator's current schedule or a source of ML accuracy.
"""

import argparse
import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path


UNIT_ID = 1166336
TR_ID = 99116336
LON = 37.6173210
LAT = 55.7551234


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("docker/local-data/live"))
    parser.add_argument("--target-host", default="host.docker.internal")
    parser.add_argument("--target-port", type=int, default=9201)
    parser.add_argument("--target-count", type=int, default=1,
                        help="number of synthetic stops, four minutes apart; use 10 for a 30-minute soak")
    args = parser.parse_args()
    if not 1 <= args.target_port <= 65535:
        parser.error("target-port must be 1…65535")
    if not 1 <= args.target_count <= 30:
        parser.error("target-count must be 1…30")
    args.output.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    # A previously scheduled stop at the stationary GPS position supplies an
    # observed deviation. The target stays strictly inside the 10–15 min window.
    rows = [(99110001, now - timedelta(seconds=600), LON, LAT,
             "Интеграционный стенд · предыдущая остановка")]
    rows.extend((99110002 + i, now + timedelta(seconds=870 + 240 * i),
                 LON, LAT + 0.070,
                 f"Интеграционный стенд · цель {i + 1}")
                for i in range(args.target_count))
    with (args.output / "schedule_plan.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("tt_action_item_id", "time_begin", "tr_id", "geom", "building_address"))
        for stop_id, when, lon, lat, name in rows:
            writer.writerow((stop_id, when.strftime("%Y-%m-%d %H:%M:%S"), TR_ID,
                             f"POINT ({lon:.7f} {lat:.7f})", name))
    (args.output / "unit-map.json").write_text(json.dumps({str(UNIT_ID): TR_ID}), encoding="utf-8")
    nav = {
        "longitude": round(LON * 10_000_000), "latitude": round(LAT * 10_000_000),
        "extraDopBit5": True, "extraDopBit6": True, "extraDopBit7": True,
        "speedAvg": 0, "speedMax": 0, "course": 0, "track": 0,
        "altitude": 200, "batVoltage": 120, "nsat": 9, "pdop": 1,
    }
    config = {
        "targetHost": args.target_host, "targetPort": args.target_port,
        "units": [
            {"unitId": UNIT_ID, "intervalMs": 3000, "autoGenerate": False,
             "cells": [{"type": "G6CellNav00", "fields": nav}]},
            # Unknown units are valid context telemetry and must not crash the pipeline.
            {"unitId": UNIT_ID + 1, "intervalMs": 5000, "autoGenerate": False,
             "cells": [{"type": "G6CellNav00", "fields": nav}]},
        ],
    }
    (args.output / "emulator-config.json").write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Synthetic NDTP smoke plan: {args.output}; {args.target_count} targets,"
          f" first UTC {rows[1][1].isoformat()}")
    print("Use immediately; regenerate before each run. Not an official live schedule.")


if __name__ == "__main__":
    main()
