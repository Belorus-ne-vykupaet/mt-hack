import json

import pytest

from criteria_helpers import DATA, METRICS, REPORT_DIR, ROOT


@pytest.fixture(autouse=True)
def _repository_root(monkeypatch):
    # Services resolve ml/artifacts and the official data relative to the repository root.
    monkeypatch.chdir(ROOT)
    monkeypatch.setenv("OFFICIAL_DATA_DIR", str(DATA))
    monkeypatch.delenv("TELEMETRY_MODE", raising=False)
    monkeypatch.delenv("LIVE_PLAN_DIR", raising=False)


def pytest_sessionfinish(session, exitstatus):
    if not METRICS:
        return
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "metrics.json"
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    existing.update(METRICS)
    path.write_text(
        json.dumps(existing, ensure_ascii=False, indent=2, default=float), encoding="utf-8"
    )
