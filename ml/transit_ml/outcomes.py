"""Confirm a warning only from an arrival observation available at the cutoff.

A missed scheduled arrival starts at its planned deadline, if arrival is later.
The fact is confirmed when arrival is observed; these are deliberately different
timestamps. The >120-second risk outcome remains separate from any lateness.
No function in this module chooses a target or issues a prediction.
"""

from datetime import datetime, timezone
from math import isfinite

from .warnings import LATENESS_THRESHOLD_SEC, MIN_LEAD_SEC, MAX_LEAD_SEC


ONSET_DEFINITION = "missed_scheduled_arrival"


def _iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


def arrival_outcome(*, planned_at, issued_at, arrival_at, observed_at, cutoff, source):
    """Return retrospective facts only when this arrival has become observable.

Never treat absence of telemetry as evidence of lateness. In replay the source
is an actual arrival row whose timestamp has passed; in NDTP it is a matched,
ordered stop visit. A false risk alert stays false even if lateness is 1–120 s.
"""
    values = (planned_at, issued_at, arrival_at, observed_at, cutoff)
    if not all(isfinite(value) for value in values):
        return None
    if arrival_at > observed_at or observed_at > cutoff or issued_at > cutoff:
        return None
    if source not in ("schedule_actual", "ndtp_ordered_stop_visit"):
        return None
    delay = arrival_at - planned_at
    onset = planned_at if delay > 0 else None
    onset_lead = onset - issued_at if onset is not None else None
    return {
        "outcome_status": "observed",
        "outcome_observed_at": _iso(observed_at),
        "outcome_source": source,
        "actual_arrival_at": _iso(arrival_at),
        "actual_delay_sec": round(delay, 3),
        "lead_to_actual_sec": round(arrival_at - issued_at, 3),
        "delay_onset_definition": ONSET_DEFINITION,
        "delay_onset_at": _iso(onset) if onset is not None else None,
        "delay_onset_basis": "planned_deadline_confirmed_by_observed_arrival",
        "lead_to_delay_onset_sec": round(onset_lead, 3) if onset_lead is not None else None,
        "warning_in_onset_window": (
            MIN_LEAD_SEC < onset_lead <= MAX_LEAD_SEC if onset_lead is not None else None
        ),
        "risk_outcome": "confirmed" if delay > LATENESS_THRESHOLD_SEC else "false_positive",
        "warning_after_arrival": issued_at >= arrival_at,
    }


def visible_outcome(record, cutoff):
    """Do not expose a previously observed outcome if a replay clock is rewound."""
    observed = record.get("outcome_observed_at")
    if observed is not None and datetime.fromisoformat(observed).timestamp() <= cutoff:
        return {key: value for key, value in record.items() if key.startswith("outcome_")
                or key in OUTCOME_FIELDS}
    planned = datetime.fromisoformat(record["target_time"]).timestamp()
    return {"outcome_status": "pending" if cutoff < planned else "awaiting_observation"}


OUTCOME_FIELDS = frozenset({
    "actual_arrival_at", "actual_delay_sec", "lead_to_actual_sec",
    "delay_onset_definition", "delay_onset_at", "delay_onset_basis",
    "lead_to_delay_onset_sec", "warning_in_onset_window", "risk_outcome",
    "warning_after_arrival",
})
