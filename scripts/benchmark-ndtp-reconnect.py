"""Pause the official emulator briefly and verify NDTP frame/forecast recovery."""

import argparse
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def request(url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=5) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("docker/local-data/live/emulator-config.json"))
    parser.add_argument("--backend", default="http://127.0.0.1:8093")
    parser.add_argument("--emulator", default="http://127.0.0.1:18080")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    if not config.get("units"):
        parser.error("config must contain at least one unit to verify recovery")
    status_url = args.backend.rstrip("/") + "/status"
    config_url = args.emulator.rstrip("/") + "/api/config"
    before = request(status_url)
    if before.get("mode") != "official-ndtp" or before.get("predictedVehicles", 0) < 1:
        parser.error("Backend must have an active NDTP forecast before disconnect")
    paused = {**config, "units": []}
    try:
        request(config_url, paused)
        time.sleep(8)
        during = request(status_url)
    finally:
        request(config_url, config)
    recovered = None
    for _ in range(20):
        time.sleep(1)
        candidate = request(status_url)
        if (candidate.get("ndtp", {}).get("frames", 0) > during.get("ndtp", {}).get("frames", 0)
                and candidate.get("predictedVehicles", 0) > 0):
            recovered = candidate
            break
    result = {
        "measuredAt": datetime.now(timezone.utc).isoformat(),
        "scope": "Synthetic current plan; official emulator binary TCP; not a forecast accuracy test",
        "before": {"frames": before["ndtp"]["frames"], "status": before["status"],
                   "predictedVehicles": before["predictedVehicles"]},
        "during": {"frames": during["ndtp"]["frames"], "status": during["status"],
                   "predictedVehicles": during["predictedVehicles"]},
        "recovered": None if recovered is None else {
            "frames": recovered["ndtp"]["frames"], "status": recovered["status"],
            "predictedVehicles": recovered["predictedVehicles"]},
        "pauseSec": 8,
    }
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    print(text, end="")
    if during["ndtp"]["frames"] > before["ndtp"]["frames"] + 1 or recovered is None:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
