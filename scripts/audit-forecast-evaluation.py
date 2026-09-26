"""Reproduce paired first forecasts using real weights and causally replayed CSV.

The provided test was used for model selection; this is integration evidence,
not an independent accuracy score. A persistent journal can be opened by the
Backend with PREDICTION_JOURNAL and the same plan/model.
"""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path

import httpx
import pandas as pd

from transit_ml.backend import Engine
from transit_ml.inference import app


async def audit(args):
    os.environ["REPLAY_SPEED"] = "0"
    os.environ["TELEMETRY_MODE"] = "replay"
    engine = Engine(journal_path=args.journal)
    start, end = (pd.Timestamp(value, tz="UTC").timestamp() for value in [args.start, args.end])
    first = {}
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://model") as client:
            engine.client, engine.ml_url = client, "http://model"
            for cutoff in range(int(start), int(end)+1, 30):
                engine.start, engine.cache_at = cutoff, 0
                await engine.snapshot()
                report = engine.journal.report(cutoff, limit=500)
                for row in report["items"]:
                    key = (row["vehicleId"], row["targetStopId"])
                    prediction = (row["issuedAt"], row["predictedDelaySec"], row["plannedAt"])
                    assert first.setdefault(key, prediction) == prediction
                    assert 600 < row["horizonSec"] <= 900
                    if row["observedAt"] is not None:
                        assert pd.Timestamp(row["actualArrivalAt"]).timestamp() <= pd.Timestamp(row["observedAt"]).timestamp() <= cutoff
    report["validation"] = {"replayStart": args.start, "replayEnd": args.end, "stepSec": 30,
                            "immutableFirstForecasts": True, "causalObservations": True,
                            "independentQualityEstimate": False}
    report["sourceSha256"] = {p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
                              for p in ["ml/transit_ml/backend.py", "ml/transit_ml/evaluation.py", "src/mt_hack/features.py"]}
    engine.journal.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--journal", type=Path)
    parser.add_argument("--start", default="2026-01-06 07:27:00")
    parser.add_argument("--end", default="2026-01-06 08:20:00")
    asyncio.run(audit(parser.parse_args()))
