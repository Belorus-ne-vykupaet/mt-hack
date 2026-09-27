"""Summarize the organizers' archive without exporting rows, device mappings or download tokens."""

import argparse
import hashlib
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile

import pandas as pd

PUBLIC = "https://disk.yandex.ru/d/CA6tsj4aJJ4Aaw"


def audit(archive, check_public=False):
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    report = {
        "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
        "publicFolder": PUBLIC, "archiveSha256": digest,
        "archiveSize": archive.stat().st_size,
        "scope": "Public archive inventory and aggregate dates/ID cardinalities; no current assignment certified.",
    }
    if check_public:
        items, offset = [], 0
        while True:
            url = "https://cloud-api.yandex.net/v1/disk/public/resources?" + urllib.parse.urlencode({
                "public_key": PUBLIC, "limit": 100, "offset": offset,
            })
            with urllib.request.urlopen(url, timeout=30) as response:
                listing = json.load(response)["_embedded"]
            items.extend({k: item.get(k) for k in ("name", "type", "size", "modified", "sha256")}
                         for item in listing["items"])
            offset += len(listing["items"])
            if offset >= listing["total"]:
                break
        report["publicFolderItems"] = items
        report["matchesPublishedArchive"] = any(item["sha256"] == digest for item in items)
        if not report["matchesPublishedArchive"]:
            raise ValueError("Local archive hash is not in the current public folder; re-download and audit")
    report["splits"] = {}
    with ZipFile(archive) as zipped:
        report["archiveFiles"] = [f.filename for f in zipped.infolist() if not f.is_dir()]
        for split in ("train", "test", "validate"):
            filename = f"{split}/" + ("schedule_plan.csv" if split == "validate" else "schedule.csv")
            with zipped.open(filename) as stream:
                schedule = pd.read_csv(stream)
            with zipped.open(f"{split}/traffic.csv") as stream:
                traffic = pd.read_csv(stream, usecols=["unit_id", "tr_id", "event_time"])
            pairs = traffic[["unit_id", "tr_id"]].drop_duplicates()
            report["splits"][split] = {
                "scheduleRows": len(schedule), "scheduleVehicles": int(schedule.tr_id.nunique()),
                "planMinRaw": schedule.time_begin.min(), "planMaxRaw": schedule.time_begin.max(),
                "telemetryRows": len(traffic), "telemetryMinRaw": traffic.event_time.min(),
                "telemetryMaxRaw": traffic.event_time.max(),
                "units": int(traffic.unit_id.nunique()), "vehicles": int(traffic.tr_id.nunique()),
                "distinctPairs": len(pairs),
                "unitsWithMultipleVehicles": int((pairs.groupby("unit_id").tr_id.nunique() > 1).sum()),
                "vehiclesWithMultipleUnits": int((pairs.groupby("tr_id").unit_id.nunique() > 1).sum()),
                "plannedVehiclesMissingTelemetry": len(set(schedule.tr_id) - set(traffic.tr_id)),
                "scheduleColumns": schedule.columns.tolist(),
            }
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--check-public", action="store_true")
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    result = audit(args.archive, args.check_public)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Aggregate source audit saved to {args.report}")
