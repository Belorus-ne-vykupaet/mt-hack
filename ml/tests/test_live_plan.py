"""Synthetic file fixtures test validation, never authenticity of an operational plan."""

import csv
import json
from datetime import datetime, timezone

import pytest

from transit_ml.live_plan import PlanError, check_live_plan

NOW = datetime(2026, 9, 27, 12, tzinfo=timezone.utc)


def bundle(tmp_path, **changes):
    rows = [
        {"tt_action_item_id": "1", "tr_id": "10", "time_begin": "2026-09-27T14:59:00+03:00",
         "geom": "POINT (37.6 55.7)", "building_address": "Synthetic fixture"},
        {"tt_action_item_id": "2", "tr_id": "10", "time_begin": "2026-09-27T15:12:00+03:00",
         "geom": "POINT (37.61 55.71)", "building_address": "Synthetic fixture"},
    ]
    rows[1].update(changes)
    with (tmp_path / "schedule_plan.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=rows[1].keys())
        writer.writeheader()
        writer.writerows(rows)
    (tmp_path / "unit-map.json").write_text('{"123":10}')
    return tmp_path


def test_explicit_moscow_offset_matches_unix_clock_without_changing_files(tmp_path):
    directory = bundle(tmp_path)
    before = {p.name: p.read_bytes() for p in directory.iterdir()}
    result = check_live_plan(directory, now=NOW)
    assert result["planEndUtc"] == "2026-09-27T12:12:00+00:00"
    assert result["vehiclesWithTargetInWindow"] == 1
    assert result["authenticityVerified"] is False
    assert before == {p.name: p.read_bytes() for p in directory.iterdir()}


@pytest.mark.parametrize("changes,reason", [
    ({"time_begin": "2026-09-27 15:12:00"}, "timezone"),
    ({"time_begin": "not-a-date"}, "ISO 8601"),
    ({"tt_action_item_id": "1"}, "unique visit"),
    ({"tr_id": "11"}, "no device assignment"),
    ({"tr_id": "1.5"}, "integers"),
    ({"geom": "POINT (55.7 137.6)"}, "out of range"),
    ({"geom": "POINT (NaN 55.7)"}, "WKT"),
    ({"time_fact_begin": "2026-09-27T12:15:00Z"}, "factual arrivals"),
])
def test_rejects_invalid_plans(tmp_path, changes, reason):
    with pytest.raises(PlanError, match=reason):
        check_live_plan(bundle(tmp_path, **changes), now=NOW)


def test_rejects_expired_archive_and_not_yet_started_plan(tmp_path):
    directory = bundle(tmp_path)
    with pytest.raises(PlanError, match="expired"):
        check_live_plan(directory, now=datetime(2026, 9, 28, tzinfo=timezone.utc))
    with pytest.raises(PlanError, match="starts beyond"):
        check_live_plan(directory, now=datetime(2026, 1, 6, tzinfo=timezone.utc))


@pytest.mark.parametrize("mapping,reason", [
    ('{"123":10,"123":11}', "Duplicate JSON key"),
    ('{"123":10,"124":10}', "Multiple devices"),
    ('{"0123":10}', "integers"),
    ('{"123":true}', "integers"),
    ('{"2147483648":10}', "range"),
    ('{}', "non-empty object"),
    ('[]', "non-empty object"),
])
def test_mapping_never_silently_overwrites_or_coerces_ids(tmp_path, mapping, reason):
    directory = bundle(tmp_path)
    (directory / "unit-map.json").write_text(mapping)
    with pytest.raises(PlanError, match=reason):
        check_live_plan(directory, now=NOW)


def test_emulator_units_checked_against_mapping_and_context_is_counted(tmp_path):
    directory = bundle(tmp_path)
    config = tmp_path / "emulator-config.json"
    config.write_text(json.dumps({"units": [{"unitId": 123}, {"unitId": 124}]}))
    with pytest.raises(PlanError, match="missing from"):
        check_live_plan(directory, now=NOW, emulator_config=config)
    (directory / "unit-map.json").write_text('{"123":10,"124":11}')
    result = check_live_plan(directory, now=NOW, emulator_config=config)
    assert result["mappedVehiclesWithoutPlan"] == 1
    assert result["configuredDevices"] == 2
