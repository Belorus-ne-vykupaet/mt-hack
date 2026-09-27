"""The live evidence tool must preserve failed observations, including cleanup errors."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest


def script(name):
    path = Path(__file__).resolve().parents[2] / "scripts" / name
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("case", ["no_warning", "cleanup_failure", "already_late"])
def test_failed_live_audit_is_saved(tmp_path, monkeypatch, case):
    prepare = script("prepare-ndtp-smoke.py")
    monkeypatch.setattr(sys, "argv", ["prepare", "--output", str(tmp_path),
                                     "--previous-stop-offset-sec", "30"])
    prepare.main()
    audit = script("audit-live-ndtp-emulator.py")
    report = tmp_path / "report.json"
    monkeypatch.setattr(sys, "argv", ["audit", "--plan", str(tmp_path),
                                     "--output", str(report), "--require-no-existing-delay"])
    clock = [audit.time.time()]
    monkeypatch.setattr(audit.time, "time", lambda: clock[0])
    monkeypatch.setattr(audit.time, "sleep", lambda seconds: clock.__setitem__(0, clock[0] + seconds))
    stops = list(audit.csv.DictReader((tmp_path / "schedule_plan.csv").open()))
    assert audit.utc_timestamp(stops[1]["time_begin"]) - audit.utc_timestamp(stops[0]["time_begin"]) == 720
    rows = ([{"target_stop_id": stops[1]["tt_action_item_id"], "current_delay_sec_at_issue": 5}]
            if case == "already_late" else [])

    def get_json(url):
        if url.endswith("/warnings/audit"):
            return {"items": rows}
        if url.endswith("/snapshot"):
            return {"vehicles": [{"id": "vehicle-99116336", "current_delay_sec": -20,
                                  "forecast_status": "ready", "forecast_model": "fixture-model"}]}
        return {"status": "connected"}

    sent = []

    def post_json(url, config):
        sent.append(len(config["units"]))
        if not config["units"] and case == "cleanup_failure":
            raise OSError("emulator unavailable during cleanup")

    monkeypatch.setattr(audit, "get_json", get_json)
    monkeypatch.setattr(audit, "post_json", post_json)
    expected = "earlier observed delay" if case == "already_late" else "no first warning"
    with pytest.raises(RuntimeError, match=expected):
        audit.main()
    result = json.loads(report.read_text())
    assert result["passed"] is False
    assert result["requireNoExistingDelay"] is True
    assert result["stage"] == "first_warning"
    assert expected in result["failure"]
    assert result["predictionObservations"][0]["current_delay_sec"] == -20
    assert result["statusAtFailure"]["status"] == "connected"
    assert result["warningsAtFailure"]["items"] == rows
    assert sent[-1] == 0
    assert ("cleanupError" in result) == (case == "cleanup_failure")
