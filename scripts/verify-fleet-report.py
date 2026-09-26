"""Acceptance checks for the documented 100-vehicle, 30-minute NDTP run.

RSS is reported in five-minute windows rather than declared leak-free from one
run. The bound on packet histories and the absence of pending work are checked
separately. This does not assess accuracy on synthetic routes.
"""
import argparse
import json
from pathlib import Path


def verify(report):
    summary, samples, config = report["summary"], report["samples"], report["config"]
    checks = {
        "full_30_minutes": not report["interrupted"] and summary["elapsedSec"] >= 1800 and config["durationSec"] >= 1800,
        "unchanged_measured_sources": not report["provenance"]["sourceChangedDuringRun"],
        "15_reading_clients": config["clients"] >= 15 and summary["wsMessages"] > 0,
        "all_100_vehicles_reach_clients": summary["observedVehicles"] == 100,
        "no_http_errors": summary["failedSamples"] == 0,
        "no_ml_fallback_or_stale_api": summary["staleSamples"] == 0 and all(s["backend"]["status"] == "connected" for s in samples),
        "no_unexpected_ws_closes": summary["wsUnexpectedCloses"] == summary["wsErrors"] == 0,
        "no_corrupt_or_unmapped_frames": summary["ndtpErrorsDelta"] == summary["ndtpUnmappedDelta"] == 0,
        "sustained_20_frames_per_second": 19 <= summary["ndtpFramesPerSec"] <= 21,
        "pipeline_p95_below_2_seconds": summary["backendPipelineMs"]["p95"] < 2000,
        "inference_p95_below_2_seconds": summary["mlInferenceMs"]["p95"] < 2000,
        "no_pending_calculation_at_samples": summary["forecastPendingSamples"] == 0,
        "bounded_30_minute_histories": all(s["backend"]["ndtp"]["historyPackets"] <= 36200 and
            s["backend"]["ndtp"]["maxHistoryPacketsPerUnit"] <= 362 for s in samples),
        "gps_loss_marks_one_vehicle_stale": any(s["backend"]["freshVehicles"] == 99 and
            s["backend"]["staleVehicles"] == 1 for s in samples),
        "gps_recovery_restores_fleet": samples[-1]["backend"]["freshVehicles"] == 100 and
            samples[-1]["backend"]["predictedVehicles"] == 100,
        "rss_measured_for_all_services": all(len(v["windows"]) >= 6 and
            all(w["count"] > 0 for w in v["windows"][:6]) for v in summary["rssMiB"].values()),
    }
    return checks


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    checks = verify(json.loads(args.report.read_text()))
    print(json.dumps({"passed": all(checks.values()), "checks": checks}, indent=2))
    raise SystemExit(0 if all(checks.values()) else 1)
