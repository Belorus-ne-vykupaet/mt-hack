"""Synthetic *current* plan and emulator config for N mapped devices (Docker audit).

Each device stands at a stop planned 5 minutes ago (observed deviation) and has
targets 12, 13 and 14 minutes ahead, so a target stays inside the 10–15 minute
window for about two minutes after generation. Not an operator's schedule.

    python make_fleet_plan.py OUTPUT_DIR N TARGET_HOST TARGET_PORT
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from criteria_helpers import write_live_plan  # noqa: E402


def main(output, n, host, port):
    now = int(time.time())
    units = [(3_000_000 + i, 90_000_000 + i) for i in range(n)]
    positions = write_live_plan(Path(output), units, now, previous_offset=-300,
                                target_offsets=(720, 780, 840))
    nav = lambda lon, lat: {
        "longitude": round(lon * 10_000_000), "latitude": round(lat * 10_000_000),
        "extraDopBit5": True, "extraDopBit6": True, "extraDopBit7": True,
        "speedAvg": 0, "speedMax": 0, "course": 0, "track": 0,
        "altitude": 200, "batVoltage": 120, "nsat": 9, "pdop": 1,
    }
    config = {
        "targetHost": host, "targetPort": port,
        "units": [
            {"unitId": unit, "intervalMs": 1000, "autoGenerate": False,
             "cells": [{"type": "G6CellNav00", "fields": nav(*positions[unit])}]}
            for unit, _ in units
        ],
    }
    (Path(output) / "emulator-config.json").write_text(json.dumps(config), encoding="utf-8")
    print(f"{n} devices, plan in {output}")


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4]))
