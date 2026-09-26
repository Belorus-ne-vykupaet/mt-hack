from __future__ import annotations

import json
import math
import os
from functools import lru_cache
from pathlib import Path

import numpy as np

FEATURE_NAMES = [
    "osm_road_count",
    "osm_signal_count",
    "osm_intersection_count",
    "osm_busway_count",
    "osm_major_road_frac",
    "osm_link_road_frac",
    "osm_roundabout_count",
    "osm_lanes_median",
    "osm_maxspeed_median",
    "target_osm_road_count",
    "target_osm_signal_count",
    "target_osm_intersection_count",
    "target_osm_busway_count",
    "target_osm_major_road_frac",
]


def _default_path() -> Path:
    return Path(os.getenv("MT_HACK_OSM_FEATURES", "ml/data/external/osm_cells.json"))


class OSMCellFeatures:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path is not None else _default_path()
        self.available = self.path.is_file()
        self.cell_deg = 0.03
        self.cells: dict[str, dict[str, float]] = {}
        if self.available:
            payload = json.loads(self.path.read_text())
            self.cell_deg = float(payload["cell_deg"])
            self.cells = payload["cells"]

    def key(self, lon: float, lat: float) -> str | None:
        if not self.available or not np.isfinite(lon) or not np.isfinite(lat):
            return None
        x = math.floor(float(lon) / self.cell_deg)
        y = math.floor(float(lat) / self.cell_deg)
        return f"{x}:{y}"

    def raw(self, lon: float, lat: float) -> dict[str, float]:
        key = self.key(lon, lat)
        if key is None:
            return {}
        return self.cells.get(key, {})

    def features(self, lon: float, lat: float, prefix: str = "") -> dict[str, float]:
        row = self.raw(lon, lat)
        names = {
            "road_count": "osm_road_count",
            "signal_count": "osm_signal_count",
            "intersection_count": "osm_intersection_count",
            "busway_count": "osm_busway_count",
            "major_road_frac": "osm_major_road_frac",
            "link_road_frac": "osm_link_road_frac",
            "roundabout_count": "osm_roundabout_count",
            "lanes_median": "osm_lanes_median",
            "maxspeed_median": "osm_maxspeed_median",
        }
        out: dict[str, float] = {}
        for source, target in names.items():
            value = row.get(source, np.nan)
            out[prefix + target] = float(value) if value is not None else np.nan
        return out


@lru_cache(maxsize=1)
def get_osm_store() -> OSMCellFeatures:
    return OSMCellFeatures()
