"""Replay the official stream through the real model and audit first warning times.

Run from the repository root:
    PYTHONPATH=ml ml/.venv/bin/python scripts/audit-early-warnings.py

Future actual arrivals are read only after inference to verify issue timing.
"""

import asyncio
import json
import os
from datetime import datetime, timezone

import httpx
import pandas as pd

from transit_ml.backend import Engine
from transit_ml.inference import app as ml_app


async def audit():
    os.environ["TELEMETRY_MODE"] = "replay"
    os.environ["REPLAY_SPEED"] = "0"
    engine = Engine()
    start = pd.Timestamp("2026-01-06T17:50:00Z").timestamp()
    end = pd.Timestamp("2026-01-06T18:35:00Z").timestamp()
    step = 30
    snapshots = 0
    ready_snapshots = 0
    active_alerts = 0
    async with ml_app.router.lifespan_context(ml_app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=ml_app), base_url="http://model"
        ) as client:
            engine.client = client
            engine.ml_url = "http://model"
            for cutoff in range(int(start), int(end) + 1, step):
                engine.start = cutoff
                engine.cache_at = 0
                snapshot = await engine.snapshot()
                snapshots += 1
                ready_snapshots += engine.status == "connected"
                active_alerts += len(snapshot["alerts"])

    records = list(engine.warning_audit)
    retrospective = []
    actual_before_issue = []
    observed_actual = 0
    for row in records:
        issued = pd.Timestamp(row["issued_at"]).timestamp()
        target = pd.Timestamp(row["target_time"]).timestamp()
        if not 600 < target - issued <= 900:
            retrospective.append(row["id"])
        tr = int(row["vehicle_id"].removeprefix("vehicle-"))
        actual = engine.actual.get(tr)
        if actual is None:
            continue
        event = actual[actual.tt_action_item_id.eq(int(row["target_stop_id"]))]
        if event.empty:
            continue
        observed_actual += 1
        if float(event.iloc[0].actual_ts) <= issued:
            actual_before_issue.append(row["id"])
    leads = [row["lead_time_sec"] for row in records]
    report = {
        "mode": "official-test-causal-replay",
        "clock_note": "CSV timestamps are compared without timezone conversion",
        "measured_at_utc": datetime.now(timezone.utc).isoformat(),
        "archive_start": pd.Timestamp(start, unit="s", tz="UTC").isoformat(),
        "archive_end": pd.Timestamp(end, unit="s", tz="UTC").isoformat(),
        "step_sec": step,
        "snapshots": snapshots,
        "model_ready_snapshots": ready_snapshots,
        "active_alert_appearances": active_alerts,
        "distinct_first_warnings": len(records),
        "ready_first_warnings": sum(r["model_status"] == "ready" for r in records),
        "fallback_first_warnings": sum(r["model_status"] == "fallback" for r in records),
        "minimum_lead_to_plan_sec": min(leads) if leads else None,
        "maximum_lead_to_plan_sec": max(leads) if leads else None,
        "actual_outcomes_available_for_audit": observed_actual,
        "warnings_issued_after_plan_window": retrospective,
        "warnings_issued_after_actual_arrival": actual_before_issue,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if retrospective or actual_before_issue or not records:
        raise SystemExit("Horizon audit failed")


if __name__ == "__main__":
    asyncio.run(audit())
