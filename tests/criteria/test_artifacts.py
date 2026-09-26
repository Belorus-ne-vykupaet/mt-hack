"""Mandatory submission artifacts (PDF, section «Обязательные артефакты на сдачу»).

1 CSV submission · 2 system in Docker started by README · 3 jury instructions ·
4 documentation (PyDoc + OpenAPI) · 5 performance and extras description.
Also checks that the documented numbers are the ones in the committed reports.
"""

import json
import re
import subprocess

import pytest
import yaml

from criteria_helpers import ROOT, record

DOCS = ["README.md", "JURY_QUICKSTART.md", "ml/README.md", "submission/README.md",
        "docs/20-reliability-benchmark.md", "docs/21-early-warning-evidence.md",
        "docs/22-criteria-evidence.md", "server/README.md"]


def _links(path):
    text = (ROOT / path).read_text(encoding="utf-8")
    for target in re.findall(r"\]\(([^)\s]+)\)", text):
        if target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        yield target.split("#")[0]


@pytest.mark.parametrize("doc", DOCS)
def test_artifacts_every_relative_link_in_the_documents_exists(doc):
    missing = [t for t in _links(doc) if t and not (ROOT / doc).parent.joinpath(t).resolve().exists()]
    assert not missing, f"{doc}: {missing}"


def test_artifacts_jury_commands_point_to_real_files_and_ports():
    quickstart = (ROOT / "JURY_QUICKSTART.md").read_text(encoding="utf-8")
    for path in re.findall(r"(scripts/[\w./-]+\.(?:py|mjs)|compose\.official\.yaml)", quickstart):
        assert (ROOT / path).exists(), path
    compose = yaml.safe_load((ROOT / "compose.official.yaml").read_text(encoding="utf-8"))
    published = {
        name: [int(str(port).split(":")[-2].split("-")[-1].strip("}")) if "${" not in str(port)
               else int(re.search(r":-(\d+)\}", str(port)).group(1)) for port in s.get("ports", [])]
        for name, s in compose["services"].items()
    }
    for port, service in ((8080, "frontend"), (8081, "api"), (8093, "backend"), (8092, "ml")):
        assert f"127.0.0.1:{port}" in quickstart, port
        assert port in published[service], (service, published[service])


def test_artifacts_criteria_matrix_numbers_match_the_committed_reports():
    audit = json.loads((ROOT / "reports/early-warning-audit-2026-09-26.json").read_text(encoding="utf-8"))
    cold = json.loads((ROOT / "reports/reliability-cold-start-2026-09-26.json").read_text(encoding="utf-8"))
    matrix = (ROOT / "docs/22-criteria-evidence.md").read_text(encoding="utf-8")
    evidence = (ROOT / "docs/21-early-warning-evidence.md").read_text(encoding="utf-8")
    facts = {
        "first warnings": (audit["distinct_first_warnings"], "95 первых предупреждений"),
        "late warned": (f"{audit['late_events_warned_before_actual']}/{audit['late_events']}", "92/120"),
        "false": (f"{audit['false_alerts']}/{audit['scored_warnings']}", "3/95"),
        "after actual": (len(audit["warnings_issued_after_actual_arrival"]), "ни одного после фактического прибытия"),
    }
    record("artifacts.early_warning_report", {k: v[0] for k, v in facts.items()})
    lead = f"{audit['minimum_lead_to_plan_sec']:.0f}–{audit['maximum_lead_to_plan_sec']:.0f} с"
    assert f"все {audit['distinct_first_warnings']} исходов" in matrix and lead in matrix
    assert f"{facts['late warned'][0]} = " in evidence and f"{facts['false'][0]} = " in evidence
    assert facts["after actual"][0] == 0
    seconds = json.dumps(cold)
    assert "17.6" in seconds and "17,60" in matrix


def test_artifacts_generated_documentation_is_present():
    docs = ROOT / "public/docs/python"
    pages = sorted(p.name for p in docs.glob("*.html"))
    record("artifacts.pydoc_pages", pages)
    assert "index.html" in pages and len(pages) >= 6
    for contract in ("contracts/openapi.json", "contracts/integration-openapi.json"):
        spec = json.loads((ROOT / contract).read_text(encoding="utf-8"))
        assert spec["openapi"].startswith("3.") and spec["paths"], contract


def test_artifacts_no_working_secrets_in_tracked_files():
    """Keys in a repository shown to the jury are published keys."""
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    leaks = []
    pattern = re.compile(r"^\s*(\w*(?:KEY|TOKEN|SECRET)\w*)\s*=\s*['\"]?([A-Za-z0-9_\-.]{16,})", re.M)
    for name in tracked:
        if not name.endswith((".env", ".env.example", ".sh", ".yaml", ".yml", ".json", ".md", ".ts", ".py", ".mjs")):
            continue
        try:
            text = (ROOT / name).read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        for match in pattern.finditer(text):
            if not re.search(r"example|your|placeholder|<|xxxx", match.group(2), re.I):
                leaks.append(f"{name}: {match.group(1)}")
    record("artifacts.tracked_secrets", leaks)
    assert not leaks, f"keys committed to Git: {leaks}"
