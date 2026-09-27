"""Observe a real 10–15 minute warning and later stop visit on the official NDTP emulator.

Uses a clearly synthetic *current* plan from prepare-ndtp-smoke.py. The clock
is not accelerated. It proves the causal stream path, not model accuracy on a
real operator schedule. Run only against an isolated NDTP backend and emulator.
"""

import argparse
import csv
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


def get_json(url):
    with urlopen(url, timeout=10) as response:
        return json.load(response)


def post_json(url, value):
    body = json.dumps(value).encode()
    request = Request(url, body, {"Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=10) as response:
        return response.read().decode()


def utc_timestamp(text):
    value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).timestamp()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=Path("docker/local-data/live-eval"))
    parser.add_argument("--backend", default="http://127.0.0.1:8193")
    parser.add_argument("--emulator", default="http://127.0.0.1:18081")
    parser.add_argument("--output", type=Path, default=Path("reports/ndtp-live-window-2026-09-27.json"))
    parser.add_argument("--arrival-delay-sec", type=int, default=130)
    parser.add_argument("--require-no-existing-delay", action="store_true",
                        help="fail unless the previous observed stop was on time or early at first warning")
    args = parser.parse_args()
    if not 121 <= args.arrival_delay_sec <= 600:
        parser.error("arrival delay must confirm the >120 second risk within 10 minutes")
    plan_path = args.plan / "schedule_plan.csv"
    with plan_path.open(newline="") as stream:
        stops = list(csv.DictReader(stream))
    if len(stops) != 2:
        parser.error("prepare a one-target synthetic plan with prepare-ndtp-smoke.py")
    match = re.fullmatch(r"POINT \(([-\d.]+) ([-\d.]+)\)", stops[1]["geom"])
    if match is None:
        parser.error("target stop geometry must be POINT (lon lat)")
    target_lon, target_lat = map(float, match.groups())
    target_at = utc_timestamp(stops[1]["time_begin"])
    arrive_at = target_at + args.arrival_delay_sec
    if not 600 < target_at - time.time() <= 900:
        parser.error("regenerate the plan immediately before starting; target must be 10–15 minutes away")
    config = json.loads((args.plan / "emulator-config.json").read_text())
    mapped = config["units"][0]
    nav = mapped["cells"][0]["fields"]
    start_lon = nav["longitude"] / 10_000_000
    start_lat = nav["latitude"] / 10_000_000
    control = args.emulator.rstrip("/") + "/api/config"
    backend = args.backend.rstrip("/")
    record = {"scope": "Official Docker NDTP emulator, synthetic current plan, real clock and selected trained ML; not a model-accuracy evaluation",
              "planSha256": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
              "targetStopId": stops[1]["tt_action_item_id"],
              "targetAt": datetime.fromtimestamp(target_at, timezone.utc).isoformat(),
              "arrivalDelaySecConfigured": args.arrival_delay_sec}

    def send_position(lon, lat, speed):
        nav.update(longitude=round(lon * 10_000_000), latitude=round(lat * 10_000_000),
                   speedAvg=speed, speedMax=speed)
        post_json(control, config)

    for attempt in range(30):
        try:
            get_json(control)
            break
        except OSError:
            if attempt == 29:
                raise RuntimeError("official NDTP emulator did not become ready")
            time.sleep(1)

    try:
        send_position(start_lon, start_lat, 0)
        warning = None
        deadline = min(time.time() + 90, target_at - 600)
        while time.time() < deadline:
            rows = get_json(backend + "/warnings/audit")["items"]
            warning = next((row for row in rows if row["target_stop_id"] == record["targetStopId"]), None)
            if warning is not None:
                break
            time.sleep(3)
        if warning is None:
            raise RuntimeError("no first warning before the 10-minute boundary")
        record["firstWarning"] = warning
        record["statusAtIssue"] = get_json(backend + "/status")
        if args.require_no_existing_delay and not (
            warning["current_delay_sec_at_issue"] is not None
            and warning["current_delay_sec_at_issue"] <= 0
        ):
            raise RuntimeError("first warning was issued after an earlier observed delay")
        if not (600 < warning["forecast_horizon_sec"] <= 900
                and 600 < warning["event_lead_time_sec"] <= 900
                and warning["source"] == "ndtp"):
            raise RuntimeError("first warning violates the live publication window")
        depart_at = time.time()
        # The next ordered visit is a real sequence of emulator GPS packets.
        # Five-second updates keep each coordinate step below the matcher's
        # jump limit even when an emulator packet follows one second later.
        while time.time() < arrive_at:
            fraction = min(0.98, max(0.01, (time.time() - depart_at) / (arrive_at - depart_at)))
            send_position(start_lon + (target_lon - start_lon) * fraction,
                          start_lat + (target_lat - start_lat) * fraction, 30)
            time.sleep(min(5, max(1, arrive_at - time.time())))
        send_position(target_lon, target_lat, 0)
        for _ in range(20):
            rows = get_json(backend + "/warnings/audit")["items"]
            observed = next((row for row in rows
                             if row["id"] == warning["id"] and row["outcome_status"] == "observed"), None)
            if observed is not None:
                break
            time.sleep(3)
        else:
            raise RuntimeError("target stop visit was not observed after arrival")
        record["observedWarning"] = observed
        record["statusAfterArrival"] = get_json(backend + "/status")
        lead_to_actual_arrival = utc_timestamp(observed["actual_arrival_at"]) - utc_timestamp(warning["issued_at"])
        record["leadToObservedArrivalSec"] = round(lead_to_actual_arrival, 1)
        if not (observed["warning_in_onset_window"] is True
                and observed["risk_outcome"] == "confirmed"
                and observed["outcome_source"] == "ndtp_ordered_stop_visit"
                and observed["actual_delay_sec"] > 120
                and 600 < lead_to_actual_arrival <= 900
                and observed["warning_after_arrival"] is False
                and observed["issued_at"] == warning["issued_at"]):
            raise RuntimeError("the observed outcome does not confirm a timely first warning")
        record["passed"] = True
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"passed": True, "output": str(args.output),
                          "leadToPlanSec": observed["forecast_horizon_sec"],
                          "leadToObservedArrivalSec": record["leadToObservedArrivalSec"],
                          "actualDelaySec": observed["actual_delay_sec"]}))
    finally:
        config["units"] = []
        post_json(control, config)


if __name__ == "__main__":
    main()
