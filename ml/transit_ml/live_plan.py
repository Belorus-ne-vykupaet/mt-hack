"""Read-only preflight for supplied NDTP plans. Format checks cannot prove provenance."""

import argparse
import csv
import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path


class PlanError(ValueError):
    pass


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise PlanError("Duplicate JSON key; mapping must be unambiguous")
        result[key] = value
    return result


def _id(value, maximum=2**53 - 1):
    # Canonical decimal strings prevent collisions such as '001' and '1'.
    if isinstance(value, bool) or not re.fullmatch(r"0|[1-9][0-9]*", str(value)):
        raise PlanError("IDs must be canonical non-negative integers")
    number = int(value)
    if number > maximum:
        raise PlanError("ID exceeds the supported range")
    return number


def _time(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError, AttributeError) as error:
        raise PlanError("time_begin must be an ISO 8601 timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise PlanError("time_begin requires an explicit timezone offset; do not guess UTC or Moscow")
    return parsed.astimezone(timezone.utc)


def check_live_plan(directory, *, now=None, emulator_config=None):
    """Validate existing files without editing dates, IDs, emulator state or the Backend."""
    directory = Path(directory)
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise PlanError("The check clock must include a timezone")
    now = now.astimezone(timezone.utc)
    mapping = json.loads((directory / "unit-map.json").read_text(encoding="utf-8-sig"),
                         object_pairs_hook=_object)
    if not isinstance(mapping, dict) or not mapping:
        raise PlanError("unit-map.json must be a non-empty object")
    units = {_id(unit, 2**31 - 1): _id(tr) for unit, tr in mapping.items()}
    if len(set(units.values())) != len(units):
        raise PlanError("Multiple devices map to one vehicle; resolve assignments before using this Backend")

    required = {"tt_action_item_id", "tr_id", "time_begin", "geom", "building_address"}
    visits, vehicles, times, targets = set(), set(), [], set()
    point = re.compile(r"POINT\s*\(\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\s*\)")
    with (directory / "schedule_plan.csv").open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        fields = reader.fieldnames or []
        if len(fields) != len(set(fields)) or not required.issubset(fields):
            raise PlanError("schedule_plan.csv requires unique UTF-8 comma-separated columns: " + ", ".join(sorted(required)))
        if any(name.startswith("time_fact") or name in {"target_delay_s", "target_class"} for name in fields):
            raise PlanError("Live plan must not contain factual arrivals or target labels")
        for index, row in enumerate(reader, 2):
            try:
                if None in row or any(row.get(name) is None for name in required):
                    raise PlanError("CSV row has the wrong number of fields")
                visit, vehicle = _id(row["tt_action_item_id"]), _id(row["tr_id"])
                if visit in visits:
                    raise PlanError("tt_action_item_id must identify a unique visit, including repeated trips")
                visits.add(visit)
                vehicles.add(vehicle)
                when = _time(row["time_begin"])
                times.append(when)
                if 600 < (when - now).total_seconds() <= 900:
                    targets.add(vehicle)
                match = point.fullmatch(row["geom"].strip())
                if not match:
                    raise PlanError("geom must be WKT POINT (longitude latitude)")
                lon, lat = map(float, match.groups())
                if not (math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
                    raise PlanError("WGS84 coordinates are out of range")
            except PlanError as error:
                raise PlanError(f"CSV row {index}: {error}") from error
    if not times:
        raise PlanError("The plan is empty")
    if vehicles - set(units.values()):
        raise PlanError("Some planned vehicles have no device assignment")
    if max(times) <= now:
        raise PlanError("The plan has expired; shifting archived dates is not an authentic live plan")
    if min(times) > now + timedelta(minutes=15):
        raise PlanError("The plan starts beyond the current 15-minute window")

    configured_count = None
    if emulator_config is not None:
        config = json.loads(Path(emulator_config).read_text(encoding="utf-8-sig"), object_pairs_hook=_object)
        entries = config.get("units") if isinstance(config, dict) else None
        if not isinstance(entries, list) or not entries:
            raise PlanError("Emulator configuration must include a non-empty units list")
        if any(not isinstance(entry, dict) or "unitId" not in entry for entry in entries):
            raise PlanError("Every configured device requires unitId")
        configured = [_id(entry["unitId"], 2**31 - 1) for entry in entries]
        if len(set(configured)) != len(configured):
            raise PlanError("Duplicate unitId in emulator configuration")
        if set(configured) - set(units):
            raise PlanError("Configured devices are missing from the supplied mapping")
        configured_count = len(configured)

    return {
        "checks": "format_ids_and_time_passed",
        "authenticityVerified": False,
        "note": "Confirm source, service date, timezone and assignment validity with the organizers before use.",
        "checkedAtUtc": now.isoformat(),
        "planStartUtc": min(times).isoformat(), "planEndUtc": max(times).isoformat(),
        "visits": len(visits), "plannedVehicles": len(vehicles), "mappedDevices": len(units),
        "mappedVehiclesWithoutPlan": len(set(units.values()) - vehicles),
        "vehiclesWithTargetInWindow": len(targets), "configuredDevices": configured_count,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--emulator-config", type=Path)
    args = parser.parse_args()
    try:
        result = check_live_plan(args.directory, emulator_config=args.emulator_config)
    except (ValueError, OSError) as error:
        parser.exit(1, f"Live-plan preflight failed: {error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
