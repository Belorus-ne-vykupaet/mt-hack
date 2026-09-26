"""Causal publication clock for a possible, explicitly defined lateness event.

The ML target stays the planned arrival within (600, 900] seconds. A warning
has an additional clock: a potential breach of the 120-second lateness
threshold at plan+120. Actual arrival is deliberately not an input here: it is
unknown when a live warning is published and is used only to score outcomes.
"""

from datetime import datetime, timezone
from math import isfinite


LATENESS_THRESHOLD_SEC = 120
MIN_LEAD_SEC = 600
MAX_LEAD_SEC = 900
EVENT_TYPE = "late_threshold"


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def warning_timing(
    plan_ts: float, cutoff: float, first_issued_at: float | None = None
) -> dict | None:
    """Return truthful first-publication timing, or defer a new warning.

    Both the ML horizon to plan and the first warning's lead to the potential
    threshold event must be in (600, 900]. Their intersection for a new warning
    is therefore 600 < plan-cutoff <= 780. Predictions and vehicle risk may be
    published over the full ML window; this function gates only the warning.

    A previously stored first issue is immutable and must itself satisfy the
    contract. Reject invalid/future first issues rather than rewriting history.
    Current countdowns are separate from the immutable publication metadata.
    """
    issued = cutoff if first_issued_at is None else first_issued_at
    if not all(isfinite(value) for value in (plan_ts, cutoff, issued)):
        return None
    if issued > cutoff:
        return None
    current_horizon = plan_ts - cutoff
    first_horizon = plan_ts - issued
    event_ts = plan_ts + LATENESS_THRESHOLD_SEC
    event_lead = event_ts - issued
    if not MIN_LEAD_SEC < current_horizon <= MAX_LEAD_SEC:
        return None
    if not MIN_LEAD_SEC < first_horizon <= MAX_LEAD_SEC:
        return None
    if not MIN_LEAD_SEC < event_lead <= MAX_LEAD_SEC:
        return None
    return {
        "issued_at": _iso(issued),
        "target_time": _iso(plan_ts),
        "event_type": EVENT_TYPE,
        "event_time": _iso(event_ts),
        "lateness_threshold_sec": LATENESS_THRESHOLD_SEC,
        # Legacy lead_time_sec always refers to plan, never to actual arrival.
        "lead_time_sec": round(first_horizon, 1),
        "forecast_horizon_sec": round(first_horizon, 1),
        "event_lead_time_sec": round(event_lead, 1),
        "current_forecast_horizon_sec": round(current_horizon, 1),
        "current_event_lead_time_sec": round(event_ts - cutoff, 1),
    }
