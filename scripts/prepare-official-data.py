"""Download the organizers' public archive, or use a local ZIP. No Docker execution."""

import argparse
import json
import shutil
import tempfile
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

PUBLIC = "https://disk.yandex.ru/d/CA6tsj4aJJ4Aaw"


def prepare(archive, destination):
    allowed = [
        "README.md",
        "sample_submission.csv",
        "train/traffic.csv",
        "train/schedule.csv",
        "test/traffic.csv",
        "test/schedule.csv",
        "validate/traffic.csv",
        "validate/schedule_plan.csv",
        "validate/points.csv",
        "labels/labels_train.csv",
        "labels/labels_test.csv",
        "docs/Emulator-and-Telematic-Packets-Specification.md",
    ]
    with zipfile.ZipFile(archive) as z:
        for name in allowed:
            if name not in z.namelist():
                raise ValueError(f"Archive is missing {name}")
        destination.mkdir(parents=True, exist_ok=True)
        for name in allowed:
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with z.open(name) as src, path.open("wb") as dst:
                shutil.copyfileobj(src, dst)
    print(
        f"Prepared official CSVs at {destination}. Emulator image was not extracted or launched."
    )


def download(archive):
    archive.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(
        "https://cloud-api.yandex.net/v1/disk/public/resources/download?"
        + urllib.parse.urlencode({"public_key": PUBLIC}),
        timeout=30,
    ) as response:
        url = json.load(response)["href"]
    print("Downloading official archive (~147 MB)...", flush=True)
    with urllib.request.urlopen(url, timeout=120) as src, archive.open("wb") as dst:
        shutil.copyfileobj(src, dst)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--archive", type=Path)
    p.add_argument("--save-archive", type=Path, help="retain the downloaded ZIP for the official emulator image")
    p.add_argument("--destination", type=Path, default=Path("ml/data/official"))
    args = p.parse_args()
    if args.archive:
        prepare(args.archive, args.destination)
    elif args.save_archive:
        download(args.save_archive)
        prepare(args.save_archive, args.destination)
    else:
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "dataset.zip"
            download(archive)
            prepare(archive, args.destination)
