"""Shared, causal features for batch training and online inference (event_time <= T)."""

import math
from pathlib import Path

import numpy as np
import pandas as pd

FEATURES = [
    "cur_dev_s",
    "horizon_s",
    "hour_sin",
    "hour_cos",
    "weekday",
    "speed_last",
    "speed_mean_120",
    "speed_mean_600",
    "speed_std_600",
    "stopped_ratio_600",
    "samples_600",
    "telemetry_age_s",
    "gps_age_s",
    "dwell_s",
    "distance_target_m",
    "required_speed_kmh",
    "heading_delta",
    "target_lat",
    "target_lon",
]


def seconds(values):
    # Official timestamps have no zone. Treat all as the same dataset clock, never infer local TZ.
    parsed = pd.to_datetime(values, format="mixed", utc=True)
    return (parsed.astype("datetime64[ns, UTC]").astype("int64") / 1e9).where(
        parsed.notna(), np.nan
    )


def distance(lon, lat, target_lon, target_lat):
    a, b = math.radians(lat), math.radians(target_lat)
    d = (
        math.sin((b - a) / 2) ** 2
        + math.cos(a) * math.cos(b) * math.sin(math.radians(target_lon - lon) / 2) ** 2
    )
    return 12742000 * math.asin(math.sqrt(min(1.0, max(0.0, d))))


class Dataset:
    """Load plan separately; future actual arrivals and labels never enter feature construction."""

    def __init__(self, folder: Path):
        self.traffic = pd.read_csv(folder / "traffic.csv", low_memory=False)
        self.traffic["ts"] = seconds(self.traffic.event_time)
        self.traffic = self.traffic.sort_values("ts", kind="stable")
        plan = folder / (
            "schedule_plan.csv"
            if (folder / "schedule_plan.csv").exists()
            else "schedule.csv"
        )
        self.schedule = pd.read_csv(
            plan,
            usecols=[
                "tt_action_item_id",
                "tr_id",
                "time_begin",
                "geom",
                "building_address",
            ],
        )
        self.schedule["ts"] = seconds(self.schedule.time_begin)
        coords = self.schedule.geom.str.extract(
            r"POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)"
        ).astype(float)
        self.schedule["lon"], self.schedule["lat"] = coords[0], coords[1]
        self.schedule = self.schedule.sort_values("ts", kind="stable")
        self.stops = self.schedule.set_index("tt_action_item_id").to_dict("index")
        self.groups = {
            int(k): v.reset_index(drop=True) for k, v in self.traffic.groupby("tr_id")
        }

    def history(self, tr_id: int, cutoff: float):
        group = self.groups.get(int(tr_id))
        if group is None:
            return pd.DataFrame(columns=self.traffic.columns)
        end = np.searchsorted(group.ts.to_numpy(), cutoff, side="right")
        start = np.searchsorted(group.ts.to_numpy(), cutoff - 1800, side="left")
        return group.iloc[start:end]

    def feature(self, point: dict, history=None):
        cutoff = (
            pd.Timestamp(point["T"], tz="UTC").timestamp()
            if not isinstance(point["T"], (int, float))
            else point["T"]
        )
        target = self.stops.get(int(point["target_stop_id"]))
        if target is None or int(target["tr_id"]) != int(point["tr_id"]):
            raise ValueError("Target arrival is absent or belongs to another vehicle")
        horizon = float(target["ts"] - cutoff)
        if not 600 < horizon <= 900:
            raise ValueError("Target must be in (T+600, T+900]")
        supplied_target = pd.Timestamp(point["target_time_begin"]).timestamp()
        if abs(supplied_target - target["ts"]) > 0.01:
            raise ValueError("Target timestamp disagrees with plan")
        h = self.history(point["tr_id"], cutoff) if history is None else history
        h = h[(h.ts <= cutoff) & (h.ts >= cutoff - 1800)].sort_values("ts")
        speed = h[h.speed.between(0, 150)]
        window = speed[speed.ts >= cutoff - 600]
        short = speed[speed.ts >= cutoff - 120]
        gps = h[
            h.location_valid.eq(True)
            & h.lon.between(-180, 180)
            & h.lat.between(-90, 90)
        ]
        last = gps.iloc[-1] if len(gps) else None
        dist = (
            distance(last.lon, last.lat, target["lon"], target["lat"])
            if last is not None
            else np.nan
        )
        dwell = 0.0
        if len(speed) and speed.iloc[-1].speed < 3:
            moving = speed[speed.speed >= 3]
            dwell = min(
                1800.0,
                cutoff - (moving.iloc[-1].ts if len(moving) else speed.iloc[0].ts),
            )
        dt = pd.Timestamp(cutoff, unit="s", tz="UTC")
        heading_delta = np.nan
        if last is not None and pd.notna(last.heading):
            bearing = (
                math.degrees(
                    math.atan2(
                        (target["lon"] - last.lon) * math.cos(math.radians(last.lat)),
                        target["lat"] - last.lat,
                    )
                )
                % 360
            )
            heading_delta = abs((bearing - last.heading + 180) % 360 - 180)
        return dict(
            zip(
                FEATURES,
                [
                    float(point["cur_dev_s"]),
                    horizon,
                    math.sin(dt.hour / 24 * 2 * math.pi),
                    math.cos(dt.hour / 24 * 2 * math.pi),
                    dt.weekday(),
                    speed.iloc[-1].speed if len(speed) else np.nan,
                    short.speed.mean(),
                    window.speed.mean(),
                    window.speed.std(ddof=0),
                    (window.speed < 3).mean() if len(window) else np.nan,
                    len(window),
                    cutoff - h.iloc[-1].ts if len(h) else 1800,
                    cutoff - last.ts if last is not None else 1800,
                    dwell,
                    dist,
                    dist / horizon * 3.6,
                    heading_delta,
                    target["lat"],
                    target["lon"],
                ],
            )
        )

    def matrix(self, points):
        return pd.DataFrame(
            [self.feature(p) for p in points.to_dict("records")], columns=FEATURES
        ).astype(float)
