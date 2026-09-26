"""Causal stop-to-stop observations, independent of the stop-arrival ML model.

The schedule orders stop *visits*, not street geometry. A segment is anchored by
an observed low-speed visit and ends at the next scheduled visit. Its geometry
contains only GPS observations. No road shape, unobserved speed, or progress is
inferred from a straight line joining stops. Instantiate ``SegmentMatcher`` once
per route; matching is bounded to recent packets and a small time-indexed set of
candidate stops, rather than comparing every packet with the entire schedule.
"""

import math

import numpy as np
import pandas as pd

from .features import distance


def _number(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _identifier(value):
    number = _number(value)
    return str(int(number)) if number is not None and number.is_integer() else str(value)


class SegmentMatcher:
    """Match ordered visits using fresh GPS and bounded schedule deviation.

    Defaults tolerate arrivals up to 30 minutes late / five minutes early (15
    minutes early for the immediate successor of an observed departed stop). A
    route with more delay, no observed stop, ambiguous co-located visits, stale
    GPS, or an observation gap remains explicitly unmatched. Delay is the last
    observed stop-arrival deviation; it is not an invented between-stop value.
    ``time_fact_begin`` and other actual/future outcome columns are never read.
    """

    def __init__(self, plan, *, route_id=None, stop_radius_m=50.0,
                 max_gps_age_sec=180.0, max_gap_sec=120.0,
                 history_sec=1800.0, max_packets=4096):
        required = {"ts", "tt_action_item_id", "lon", "lat"}
        self.stops = []
        if required.issubset(plan.columns):
            # Keep invalid-coordinate stops in sequence: omitting them would
            # falsely claim that nonconsecutive stops are an actual segment.
            for sequence, row in enumerate(plan.sort_values("ts", kind="stable").to_dict("records")):
                planned = _number(row["ts"])
                if planned is None:
                    continue
                self.stops.append({
                    "id": _identifier(row["tt_action_item_id"]),
                    "sequence": sequence,
                    "planned_at": planned,
                    "lon": _number(row["lon"]), "lat": _number(row["lat"]),
                    "name": str(row.get("building_address") or row["tt_action_item_id"]),
                })
        self.times = np.array([s["planned_at"] for s in self.stops])
        self.route_id = route_id or (
            f"duty-{_identifier(plan.iloc[0]['tr_id'])}"
            if len(plan) and "tr_id" in plan.columns else "route"
        )
        self.radius = stop_radius_m
        self.max_age = max_gps_age_sec
        self.max_gap = max_gap_sec
        self.history_sec = history_sec
        self.max_packets = max_packets

    @staticmethod
    def _valid_stop(stop):
        return (stop["lon"] is not None and stop["lat"] is not None
                and -180 <= stop["lon"] <= 180 and -90 <= stop["lat"] <= 90)

    def _candidate(self, row, anchor, departed, delay, excursion=0.0, minimum_index=0):
        if row["speed"] is None or not 0 <= row["speed"] <= 3:
            return None
        start = max(minimum_index, int(np.searchsorted(self.times, row["ts"] - 1800, side="left")))
        end = int(np.searchsorted(self.times, row["ts"] + 300, side="right"))
        if anchor is not None:
            start = max(start, anchor + (1 if departed else 0))
            if departed and anchor + 1 < len(self.stops) and self.times[anchor + 1] <= row["ts"] + 900:
                # An observed visit followed by departure identifies the next
                # visit even when the bus arrives >5 minutes early. This wider
                # allowance applies only to that immediate ordered successor;
                # an unanchored GPS point cannot consume arbitrary future stops.
                end = max(end, anchor + 2)
            if not departed:
                end = min(end, anchor + 1)
        indices = range(start, end)
        # Avoid pathological plans turning each packet into a full-plan scan.
        if end - start > 64:
            center = int(np.searchsorted(self.times, row["ts"] - (delay or 0)))
            start = max(start, min(center - 32, end - 64))
            indices = range(start, min(end, start + 64))
        candidates = []
        for index in indices:
            stop = self.stops[index]
            if not self._valid_stop(stop):
                continue
            if anchor is not None and index != anchor:
                origin = self.stops[anchor]
                separation = distance(origin["lon"], origin["lat"], stop["lon"], stop["lat"])
                # Speed jitter during one long stationary visit must not consume
                # later scheduled visits to the same physical stop.
                if separation < 10 and excursion <= self.radius:
                    continue
            meters = distance(row["lon"], row["lat"], stop["lon"], stop["lat"])
            if meters <= self.radius:
                skew = abs(row["ts"] - stop["planned_at"] - (delay or 0))
                candidates.append((meters, skew, index))
        if not candidates:
            return None
        # Spatial distance first separates adjacent stops. Temporal continuity
        # disambiguates visits to the same physical stop on subsequent laps.
        candidates.sort(key=lambda c: (round(c[0] / 5), c[1], c[2]))
        best = candidates[0]
        if len(candidates) > 1 and abs(candidates[1][0] - best[0]) < 5 and abs(candidates[1][1] - best[1]) < 30:
            return None
        return best[2]

    def _segment(self, index, visit):
        if index + 1 >= len(self.stops):
            return None
        first, last = self.stops[index:index + 2]
        return {
            "id": f"segment-{self.route_id}-{first['id']}-{last['id']}",
            "route_id": self.route_id,
            "from_stop_id": first["id"], "to_stop_id": last["id"],
            "from_stop_name": first["name"], "to_stop_name": last["name"],
            "from_sequence": first["sequence"], "to_sequence": last["sequence"],
            "name": f"{first['name']} → {last['name']}",
            "started_at": visit["observed_at"], "ended_at": None,
            "current_delay_sec": visit["delay_sec"],
            "matching_method": "ordered_stop_visits",
            "geometry_source": "observed_gps",
            "is_current": True, "complete": False,
            "_rows": [],
        }

    def _metrics(self, segment):
        rows = segment.pop("_rows")
        paths, current_path = [], []
        coverage = speed_time = weighted_speed = stopped_time = traveled = 0.0
        previous = None
        for row in rows:
            point = [row["lon"], row["lat"]]
            if previous is not None:
                elapsed = row["ts"] - previous["ts"]
                meters = distance(previous["lon"], previous["lat"], *point)
                continuous = 0 < elapsed <= self.max_gap and meters <= 150 / 3.6 * elapsed + 50
                if continuous:
                    coverage += elapsed
                    traveled += meters
                    a, b = previous["speed"], row["speed"]
                    if a is not None and b is not None and 0 <= a <= 150 and 0 <= b <= 150:
                        speed_time += elapsed
                        weighted_speed += (a + b) * 0.5 * elapsed
                        if a < 3 and b < 3:
                            stopped_time += elapsed
                else:
                    if len(current_path) > 1:
                        paths.append(current_path)
                    current_path = []
            if not current_path or current_path[-1] != point:
                current_path.append(point)
            previous = row
        if len(current_path) > 1:
            paths.append(current_path)
        # Bound serialized map data while retaining observed endpoints.
        reduced = []
        for path in paths:
            stride = max(1, math.ceil(len(path) / 200))
            line = path[::stride]
            if line[-1] != path[-1]:
                line.append(path[-1])
            reduced.append(line)
        segment.update({
            "geometry": {"type": "LineString", "coordinates": max(reduced, key=len) if reduced else []},
            "observed_paths": reduced,
            "mean_speed_kmh": round(weighted_speed / speed_time, 2) if speed_time else None,
            "dwell_sec": round(stopped_time, 1) if speed_time else None,
            "observed_distance_m": round(traveled, 1) if coverage else None,
            "coverage_sec": round(coverage, 1), "sample_count": len(rows),
            "progress": None,  # No road geometry => no honest route-distance percentage.
        })
        return segment

    def match(self, history, cutoff):
        """Return observed segments, ordered stop visits, and current match state.

        Target-stop forecast fields are intentionally absent from each segment:
        the caller may attach them with explicit ``forecast_scope='target_stop'``
        and the target id, but must not call them a segment-trained prediction.
        """
        result = {"status": "unavailable", "reason": None,
                  "current_segment_id": None, "current_delay_sec": None,
                  "current_segment": None, "segments": [],
                  "stop_visits": [], "observed_stop_ids": []}
        if len(self.stops) < 2:
            result["reason"] = "insufficient_schedule"
            return result
        required = {"ts", "lon", "lat", "speed", "location_valid"}
        if history.empty or not required.issubset(history.columns):
            result["reason"] = "missing_gps"
            return result
        # Explicitly discard future and invalid packets even for caller-supplied
        # history. Stable sorting makes out-of-order NDTP delivery reproducible.
        h = history[(history.ts <= cutoff) & (history.ts >= cutoff - self.history_sec)]
        h = h[h.location_valid.eq(True) & h.lon.between(-180, 180) & h.lat.between(-90, 90)]
        h = h.sort_values("ts", kind="stable").drop_duplicates("ts", keep="last").tail(self.max_packets)
        if h.empty:
            result["reason"] = "missing_gps"
            return result
        if cutoff - float(h.iloc[-1].ts) > self.max_age:
            result["reason"] = "stale_gps"
            return result
        anchor = active = previous = None
        departed = False
        excursion = 0.0
        delay = None
        segments = []
        visits = []
        visited = {}
        furthest_anchor = 0
        for packet in h[["ts", "lon", "lat", "speed"]].itertuples(index=False):
            row = {key: _number(value) for key, value in zip(("ts", "lon", "lat", "speed"), packet)}
            if previous is not None:
                elapsed = row["ts"] - previous["ts"]
                jump = distance(previous["lon"], previous["lat"], row["lon"], row["lat"])
                if elapsed > self.max_gap or jump > 150 / 3.6 * elapsed + 50:
                    if active is not None:
                        active["is_current"] = False
                    anchor = active = None
                    departed = False
                    excursion = 0.0
                    delay = None
            if anchor is not None:
                origin = self.stops[anchor]
                if self._valid_stop(origin):
                    excursion = max(excursion, distance(row["lon"], row["lat"], origin["lon"], origin["lat"]))
                departed = departed or ((row["speed"] is not None and row["speed"] > 3) or excursion > self.radius)
            candidate = self._candidate(row, anchor, departed, delay, excursion, furthest_anchor)
            if candidate is not None and candidate != anchor:
                if active is not None:
                    if candidate == anchor + 1:
                        active["_rows"].append(row)
                        active["is_current"] = False
                        active["complete"] = True
                        active["ended_at"] = row["ts"]
                    else:
                        # Missing intermediate stop visits make the boundary
                        # unknown. Do not label a multi-segment journey as the
                        # speed or geometry of one scheduled segment.
                        segments.remove(active)
                anchor = candidate
                furthest_anchor = max(furthest_anchor, anchor)
                stop = self.stops[anchor]
                delay = row["ts"] - stop["planned_at"]
                visit = {"stop_id": stop["id"], "sequence": stop["sequence"],
                         "observed_at": row["ts"], "planned_at": stop["planned_at"],
                         "delay_sec": delay, "source": "gps_stop_visit"}
                # Reacquiring the same scheduled visit after a gap does not
                # turn the second stationary packet into a later arrival.
                if stop["id"] in visited:
                    visit = visited[stop["id"]]
                    delay = visit["delay_sec"]
                else:
                    visits.append(visit)
                    visited[stop["id"]] = visit
                active = self._segment(anchor, visit)
                if active is not None:
                    segments.append(active)
                departed = False
                excursion = 0.0
            if active is not None:
                active["_rows"].append(row)
            previous = row
        # A continuity reset can reacquire one scheduled segment. Publish its
        # most recent evidence once, keeping identifiers unique for the UI.
        unique = {}
        for segment in segments:
            unique.pop(segment["id"], None)
            unique[segment["id"]] = segment
        observed = [self._metrics(segment) for segment in list(unique.values())[-32:]]
        result.update({"segments": observed, "stop_visits": visits,
                       "observed_stop_ids": list(dict.fromkeys(v["stop_id"] for v in visits))})
        if active is not None:
            result.update({"status": "matched", "reason": None,
                           "current_segment_id": active["id"],
                           "current_delay_sec": delay, "current_segment": active})
        elif anchor is not None:
            result.update({"status": "terminal", "reason": "last_planned_stop",
                           "current_delay_sec": delay})
        else:
            result["reason"] = "no_recent_ordered_stop_visit"
        return result


def match_segment(plan, history, cutoff, **options):
    """Convenience API; reuse ``SegmentMatcher(plan)`` in a streaming backend."""
    return SegmentMatcher(plan, **options).match(history, cutoff)
