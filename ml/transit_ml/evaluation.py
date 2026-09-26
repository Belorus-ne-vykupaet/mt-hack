"""Bounded, durable first forecasts paired only with causally observed arrivals."""

import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


class ForecastJournal:
    def __init__(self, namespace, path=None, limit=20000):
        self.namespace = namespace
        self.limit = limit
        if path:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path) if path else ":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA auto_vacuum=INCREMENTAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS forecasts (
                namespace TEXT, vehicle_id TEXT, target_id TEXT, stop_name TEXT,
                issued_at REAL, planned_at REAL, predicted REAL, model TEXT,
                arrival_at REAL, observed_at REAL, outcome_source TEXT,
                PRIMARY KEY(namespace, vehicle_id, target_id)
            );
            CREATE INDEX IF NOT EXISTS forecast_pending
                ON forecasts(namespace, observed_at, issued_at);
        """)

    def issue(self, rows):
        """The first successful model forecast is immutable, including after restart."""
        values = []
        for row in rows:
            issued, planned, prediction = row["issued_at"], row["planned_at"], row["predicted"]
            if not all(math.isfinite(x) for x in (issued, planned, prediction)):
                continue
            if not 600 < planned - issued <= 900:
                continue
            values.append((self.namespace, row["vehicle_id"], row["target_id"],
                           row["stop_name"], issued, planned, prediction, row["model"]))
        with self.db:
            before = self.db.total_changes
            self.db.executemany("""INSERT OR IGNORE INTO forecasts
                (namespace,vehicle_id,target_id,stop_name,issued_at,planned_at,predicted,model)
                VALUES (?,?,?,?,?,?,?,?)""", values)
            # Bound the entire database, including old plan/model namespaces.
            if self.db.total_changes > before:
                self.db.execute("""DELETE FROM forecasts WHERE rowid IN
                    (SELECT rowid FROM forecasts ORDER BY issued_at DESC, rowid DESC LIMIT -1 OFFSET ?)""",
                    (self.limit,))

    def pending(self, cutoff):
        return self.db.execute("""SELECT vehicle_id,target_id,planned_at,issued_at
            FROM forecasts WHERE namespace=? AND observed_at IS NULL AND issued_at<=?""",
            (self.namespace, cutoff)).fetchall()

    def observe(self, arrivals, cutoff, source):
        if source not in ("schedule_actual", "ndtp_ordered_stop_visit"):
            raise ValueError("Unsupported arrival observation source")
        with self.db:
            for (vehicle, target), arrived in arrivals.items():
                if not math.isfinite(arrived) or arrived > cutoff:
                    continue
                self.db.execute("""UPDATE forecasts SET arrival_at=?,observed_at=?,outcome_source=?
                    WHERE namespace=? AND vehicle_id=? AND target_id=? AND observed_at IS NULL
                    AND issued_at<=?""",
                    (arrived, cutoff, source, self.namespace, vehicle, target, arrived))

    def report(self, cutoff, route_ids=(), limit=200):
        clauses = "namespace=? AND issued_at<=?"
        args = [self.namespace, cutoff]
        if route_ids:
            vehicles = [route.replace("duty-", "vehicle-", 1) for route in route_ids]
            clauses += " AND vehicle_id IN (" + ",".join("?" for _ in vehicles) + ")"
            args.extend(vehicles)
        rows = self.db.execute(f"SELECT * FROM forecasts WHERE {clauses} ORDER BY planned_at DESC, vehicle_id", args).fetchall()
        items, errors = [], []
        observed = awaiting = 0
        for row in rows:
            visible = row["observed_at"] is not None and row["observed_at"] <= cutoff
            actual = row["arrival_at"] - row["planned_at"] if visible else None
            error = row["predicted"] - actual if visible else None
            observed += visible
            awaiting += not visible and row["planned_at"] <= cutoff
            if visible:
                errors.append(error)
            items.append({
                "vehicleId": row["vehicle_id"], "routeId": row["vehicle_id"].replace("vehicle-", "duty-", 1),
                "targetStopId": row["target_id"], "stopName": row["stop_name"],
                "issuedAt": iso(row["issued_at"]), "plannedAt": iso(row["planned_at"]),
                "horizonSec": round(row["planned_at"] - row["issued_at"], 3),
                "predictedDelaySec": row["predicted"], "actualDelaySec": actual,
                "absoluteErrorSec": abs(error) if visible else None,
                "actualArrivalAt": iso(row["arrival_at"]) if visible else None,
                "observedAt": iso(row["observed_at"]) if visible else None,
                "status": "observed" if visible else "awaiting_observation" if row["planned_at"] <= cutoff else "pending",
                "modelVersion": row["model"], "outcomeSource": row["outcome_source"] if visible else None,
            })
        # Put recent completed pairs first so pending targets do not hide evidence.
        items.sort(key=lambda row: row["status"] != "observed")
        return {
            "asOf": iso(cutoff), "namespace": self.namespace,
            "scope": "first_successful_model_forecast_per_vehicle_and_target",
            "retentionLimit": self.limit, "returned": min(limit, len(items)),
            "summary": {"total": len(rows), "observed": observed,
                        "pending": len(rows) - observed - awaiting, "awaitingObservation": awaiting,
                        "maeSec": sum(abs(e) for e in errors) / observed if observed else None,
                        "biasSec": sum(errors) / observed if observed else None},
            "items": items[:limit],
        }

    def close(self):
        self.db.close()
