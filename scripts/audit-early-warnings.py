"""Replay the official stream through the real model and audit first warning times.

Run from the repository root:
    PYTHONPATH=ml:src ml/.venv/bin/python scripts/audit-early-warnings.py

Future actual arrivals are read only after inference to verify issue timing.
"""

import asyncio
import json
import os
from datetime import datetime, timezone

import httpx
import numpy as np
import pandas as pd

from transit_ml.backend import Engine
from transit_ml.inference import app as ml_app
from transit_ml.warnings import EVENT_TYPE, LATENESS_THRESHOLD_SEC


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
    prediction_opportunities = set()
    forecast_horizon_violations = []
    first_issue_mutations = []
    first_issue_by_id = {}
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
                for vehicle in snapshot["vehicles"]:
                    horizon = vehicle.get("forecast_horizon_sec")
                    if horizon is not None and not 600 < horizon <= 900:
                        forecast_horizon_violations.append({
                            "vehicle_id": vehicle["id"], "cutoff": cutoff,
                            "forecast_horizon_sec": horizon,
                        })
                for alert in snapshot["alerts"]:
                    immutable = {
                        key: alert.get(key) for key in (
                            "created_at", "target_time", "event_time",
                            "lead_time_sec", "forecast_horizon_sec", "event_lead_time_sec",
                        )
                    }
                    previous = first_issue_by_id.setdefault(alert["id"], immutable)
                    if immutable != previous:
                        first_issue_mutations.append(alert["id"])
                prediction_opportunities.update(
                    (int(vehicle["id"].removeprefix("vehicle-")),
                     int(vehicle["next_stop"]["id"]))
                    for vehicle in snapshot["vehicles"]
                    if vehicle["forecast_status"] == "ready"
                    and vehicle["next_stop"] is not None
                )

    records = list(engine.warning_audit)
    retrospective = []
    event_window_violations = []
    event_metadata_violations = []
    actual_before_issue = []
    warning_rows = []
    warning_by_target = {}
    for row in records:
        issued = pd.Timestamp(row["issued_at"]).timestamp()
        target = pd.Timestamp(row["target_time"]).timestamp()
        if not 600 < target - issued <= 900:
            retrospective.append(row["id"])
        expected_event = target + LATENESS_THRESHOLD_SEC
        if not 600 < expected_event - issued <= 900:
            event_window_violations.append(row["id"])
        event_time = row.get("event_time")
        if (
            row.get("event_type") != EVENT_TYPE
            or event_time is None
            or abs(pd.Timestamp(event_time).timestamp() - expected_event) > 0.001
            or row.get("event_lead_time_sec") != round(expected_event - issued, 1)
            or row.get("forecast_horizon_sec") != round(target - issued, 1)
        ):
            event_metadata_violations.append(row["id"])
        tr = int(row["vehicle_id"].removeprefix("vehicle-"))
        actual = engine.actual.get(tr)
        event = (
            actual[actual.tt_action_item_id.eq(int(row["target_stop_id"]))]
            if actual is not None else pd.DataFrame()
        )
        observed_time = float(event.iloc[0].actual_ts) if not event.empty else None
        delay = float(event.iloc[0].actual_ts - event.iloc[0].plan_ts) if not event.empty else None
        if observed_time is not None and observed_time <= issued:
            actual_before_issue.append(row["id"])
        warning_rows.append({
            **row,
            "actual_arrival_at": pd.Timestamp(observed_time, unit="s", tz="UTC").isoformat()
            if observed_time is not None else None,
            "actual_delay_sec": round(delay, 1) if delay is not None else None,
            "lead_to_actual_sec": round(observed_time - issued, 1)
            if observed_time is not None else None,
            # The event clock is declared from plan for every warning, including
            # false positives. The outcome alone is determined retrospectively.
            "event_occurred": delay > LATENESS_THRESHOLD_SEC if delay is not None else None,
            "first_threshold_exceedance_at": pd.Timestamp(expected_event, unit="s", tz="UTC").isoformat()
            if delay is not None and delay > LATENESS_THRESHOLD_SEC else None,
            "lead_to_threshold_sec": round(expected_event - issued, 1)
            if delay is not None and delay > LATENESS_THRESHOLD_SEC else None,
        })
        warning_by_target[(tr, int(row["target_stop_id"]))] = warning_rows[-1]

    # Fixed denominator: every plan row that could enter the strict horizon
    # during this replay, including vehicles with no usable GPS or prediction.
    plan = pd.concat(engine.plans.values(), ignore_index=True)
    plan = plan[(plan.ts > start + 600) & (plan.ts <= end + 900)]
    plan = plan.drop_duplicates(["tr_id", "tt_action_item_id"])
    scored_events = []
    for event in plan.itertuples():
        actual = engine.actual.get(int(event.tr_id))
        matched = (
            actual[actual.tt_action_item_id.eq(event.tt_action_item_id)]
            if actual is not None else pd.DataFrame()
        )
        if matched.empty:
            continue
        actual_time = float(matched.iloc[0].actual_ts)
        delay = actual_time - float(event.ts)
        warning = warning_by_target.get((int(event.tr_id), int(event.tt_action_item_id)))
        issued = pd.Timestamp(warning["issued_at"]).timestamp() if warning else None
        scored_events.append({
            "tr_id": int(event.tr_id),
            "target_stop_id": int(event.tt_action_item_id),
            "planned_at": pd.Timestamp(event.ts, unit="s", tz="UTC").isoformat(),
            "actual_at": pd.Timestamp(actual_time, unit="s", tz="UTC").isoformat(),
            "actual_delay_sec": round(delay, 1),
            "late_event": delay > 120,
            "had_ready_prediction": (int(event.tr_id), int(event.tt_action_item_id))
            in prediction_opportunities,
            "warning_before_actual": issued is not None and issued < actual_time,
            "warning_before_event": issued is not None and issued < float(event.ts) + LATENESS_THRESHOLD_SEC,
            "warning_in_event_window": issued is not None
            and 600 < float(event.ts) + LATENESS_THRESHOLD_SEC - issued <= 900,
        })

    late_events = [event for event in scored_events if event["late_event"]]
    ready_late_events = [event for event in late_events if event["had_ready_prediction"]]
    detected = sum(event["warning_before_actual"] for event in late_events)
    detected_ready = sum(event["warning_before_actual"] for event in ready_late_events)
    detected_in_window = sum(event["warning_in_event_window"] for event in late_events)
    false_alerts = [row for row in warning_rows if row["actual_delay_sec"] is not None
                    and row["actual_delay_sec"] <= 120]
    actual_leads = [row["lead_to_actual_sec"] for row in warning_rows
                    if row["lead_to_actual_sec"] is not None]
    threshold_leads = [row["lead_to_threshold_sec"] for row in warning_rows
                       if row["lead_to_threshold_sec"] is not None]
    leads = [row["lead_time_sec"] for row in records]
    declared_event_leads = [row["event_lead_time_sec"] for row in records
                            if row.get("event_lead_time_sec") is not None]
    def distribution(values):
        return {
            "min": round(float(min(values)), 1),
            "p05": round(float(np.percentile(values, 5)), 1),
            "median": round(float(np.median(values)), 1),
            "p95": round(float(np.percentile(values, 95)), 1),
            "max": round(float(max(values)), 1),
        } if values else None

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
        "actual_outcomes_available_for_audit": len(actual_leads),
        "warnings_issued_after_plan_window": retrospective,
        "warnings_outside_event_window": event_window_violations,
        "warning_event_metadata_violations": event_metadata_violations,
        "forecast_horizon_violations": forecast_horizon_violations,
        "first_issue_mutations": sorted(set(first_issue_mutations)),
        "warnings_issued_after_actual_arrival": actual_before_issue,
        "event_type": EVENT_TYPE,
        "event_rule": "potential lateness threshold breach at planned arrival + 120 seconds; event occurs only if actual arrival is >120 seconds late",
        "publication_rule": "ML target: 600 < plan-T <= 900; first warning additionally requires 600 < plan+120-T <= 900; actual outcome is never a publication input",
        "denominator_rule": "frozen original forecast denominator: all distinct scheduled arrivals with plan in (start+600s, end+900s] and known actual arrival, including missing GPS; not narrowed to the new warning window",
        "scheduled_targets_in_window": len(plan),
        "targets_with_actual_outcome": len(scored_events),
        "late_events": len(late_events),
        "late_events_warned_before_actual": detected,
        "late_events_warned_in_event_window": detected_in_window,
        "late_events_missed_in_event_window": len(late_events) - detected_in_window,
        "late_event_window_recall": round(detected_in_window / len(late_events), 4)
        if late_events else None,
        "late_event_recall": round(detected / len(late_events), 4) if late_events else None,
        "late_events_with_ready_prediction": len(ready_late_events),
        "ready_late_events_warned_before_actual": detected_ready,
        "ready_late_event_recall": round(detected_ready / len(ready_late_events), 4)
        if ready_late_events else None,
        "false_alerts": len(false_alerts),
        "scored_warnings": len(actual_leads),
        "false_alert_fraction": round(len(false_alerts) / len(actual_leads), 4)
        if actual_leads else None,
        "lead_to_actual_sec": distribution(actual_leads),
        "lead_to_declared_event_sec": distribution(declared_event_leads),
        "lead_to_late_threshold_sec": distribution(threshold_leads),
        "events": scored_events,
        "warnings": warning_rows,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if (retrospective or event_window_violations or event_metadata_violations
            or forecast_horizon_violations or first_issue_mutations
            or actual_before_issue or not records):
        raise SystemExit("Horizon audit failed")


if __name__ == "__main__":
    asyncio.run(audit())
