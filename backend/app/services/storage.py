"""Local research storage. One API process owns the background worker."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import os
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(os.environ.get("STOCK_RESEARCH_DIR", str(Path(__file__).resolve().parents[2] / ".cache")))


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not np.isfinite(value):
        return None
    return value


def validate_history(frame: pd.DataFrame) -> dict[str, Any]:
    required = ["Open", "High", "Low", "Close", "Volume"]
    if frame.empty or not set(required).issubset(frame.columns):
        raise ValueError("The provider returned an incomplete price history.")
    if frame.index.has_duplicates or not frame.index.is_monotonic_increasing:
        raise ValueError("Historical dates must be unique and increasing.")
    values = frame[required].to_numpy(dtype=float)
    if not np.isfinite(values).all() or (values[:, :4] <= 0).any() or (values[:, 4] < 0).any():
        raise ValueError("Historical prices must be finite and positive; volume cannot be negative.")
    tolerance = frame["Close"].abs() * 1e-6
    if ((frame["High"] + tolerance < frame[["Open", "Close"]].max(axis=1)) |
        (frame["Low"] - tolerance > frame[["Open", "Close"]].min(axis=1))).any():
        raise ValueError("The provider returned inconsistent daily price ranges.")
    dates = pd.DatetimeIndex([item.date() for item in frame.index])
    if dates.has_duplicates:
        raise ValueError("Only one daily observation per session is supported.")
    gaps = dates.to_series().diff().dt.days.dropna()
    return {"observations": len(frame), "first_date": dates[0].date().isoformat(),
            "last_date": dates[-1].date().isoformat(), "gaps_over_7_days": int((gaps > 7).sum()),
            "adjusted_prices_available": "Adj Close" in frame and bool(frame["Adj Close"].notna().all())}


class ResearchStore:
    def __init__(self, root: Path = ROOT):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.artifacts = self.root / "models"
        self.artifacts.mkdir(exist_ok=True)
        self.path = self.root / "research.sqlite3"
        with self.connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS snapshots (
              id TEXT PRIMARY KEY, symbol TEXT NOT NULL, period TEXT NOT NULL,
              created_at REAL NOT NULL, checksum TEXT NOT NULL,
              frame_json TEXT NOT NULL, quality_json TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS snapshot_lookup ON snapshots(symbol, period, created_at);
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY, cache_key TEXT UNIQUE NOT NULL, kind TEXT NOT NULL,
              params_json TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
              stage TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
              created_at REAL NOT NULL, updated_at REAL NOT NULL, available_at REAL NOT NULL,
              completed_at REAL, result_json TEXT, error TEXT);
            CREATE INDEX IF NOT EXISTS job_queue ON jobs(status, available_at, created_at);
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=15000")
        try:
            with db:
                yield db
        finally:
            db.close()

    def save_snapshot(self, symbol: str, period: str, frame: pd.DataFrame) -> dict[str, Any]:
        quality = validate_history(frame)
        columns = [name for name in ["Open", "High", "Low", "Close", "Volume", "Adj Close", "Dividends", "Stock Splits"] if name in frame]
        records = [{"date": index.date().isoformat(), **{name: float(row[name]) for name in columns}}
                   for index, row in frame.iterrows()]
        payload = json.dumps(json_safe(records), sort_keys=True, separators=(",", ":"), allow_nan=False)
        checksum = hashlib.sha256(payload.encode()).hexdigest()
        identity = hashlib.sha256(f"{symbol}|{period}|{checksum}".encode()).hexdigest()[:24]
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO snapshots VALUES (?,?,?,?,?,?,?)",
                       (identity, symbol, period, time.time(), checksum, payload, json.dumps(quality)))
        return self.snapshot(identity)[0]

    def snapshot(self, identity: str) -> tuple[dict[str, Any], pd.DataFrame]:
        with self.connect() as db:
            row = db.execute("SELECT * FROM snapshots WHERE id=?", (identity,)).fetchone()
        if row is None:
            raise LookupError("Saved dataset not found.")
        frame = pd.DataFrame(json.loads(row["frame_json"]))
        frame.index = pd.to_datetime(frame.pop("date"))
        metadata = {key: row[key] for key in ["id", "symbol", "period", "created_at", "checksum"]}
        metadata["quality"] = json.loads(row["quality_json"])
        return metadata, frame

    def enqueue(self, kind: str, params: dict[str, Any], version: str, force: bool = False) -> dict[str, Any]:
        now = time.time()
        # Input/version + 15-minute freshness window; refresh deliberately creates a new run.
        key = hashlib.sha256(json.dumps([kind, params, version, int(now // 900)], sort_keys=True).encode()).hexdigest()
        if force:
            key += uuid.uuid4().hex
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT id,status FROM jobs WHERE cache_key=?", (key,)).fetchone()
            if previous and previous["status"] != "failed":
                identity = previous["id"]
                reused = True
            else:
                if db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0] >= 20:
                    raise OverflowError("The research queue is full. Wait for a run to finish.")
                if previous:
                    key += uuid.uuid4().hex
                identity = uuid.uuid4().hex
                db.execute("INSERT INTO jobs (id,cache_key,kind,params_json,status,stage,created_at,updated_at,available_at) VALUES (?,?,?,?,?,?,?,?,?)",
                           (identity, key, kind, json.dumps(params), "queued", "Waiting for worker", now, now, now))
                reused = False
        result = self.job(identity)
        result["reused"] = reused
        return result

    def job(self, identity: str, include_result: bool = True) -> dict[str, Any]:
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (identity,)).fetchone()
        if row is None:
            raise LookupError("Research run not found.")
        result = {key: row[key] for key in ["id", "kind", "status", "progress", "stage", "attempts", "created_at", "updated_at", "completed_at", "error"]}
        result["params"] = json.loads(row["params_json"])
        result["result"] = json.loads(row["result_json"]) if include_result and row["result_json"] else None
        return result

    def list_jobs(self, limit: int = 20) -> list[dict[str, Any]]:
        with self.connect() as db:
            identities = db.execute("SELECT id FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [self.job(row["id"], include_result=False) for row in identities]

    def recover(self) -> None:
        with self.connect() as db:
            db.execute("UPDATE jobs SET status='queued',stage='Resuming interrupted run',progress=0,available_at=? WHERE status='running'", (time.time(),))

    def claim(self) -> dict[str, Any] | None:
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT id FROM jobs WHERE status='queued' AND available_at<=? ORDER BY created_at LIMIT 1", (time.time(),)).fetchone()
            if row is None:
                return None
            db.execute("UPDATE jobs SET status='running',attempts=attempts+1,stage='Starting run',updated_at=? WHERE id=?", (time.time(), row["id"]))
        return self.job(row["id"])

    def progress(self, identity: str, percent: int, stage: str) -> None:
        with self.connect() as db:
            db.execute("UPDATE jobs SET progress=MAX(progress,?),stage=?,updated_at=? WHERE id=?", (max(0, min(99, percent)), stage, time.time(), identity))

    def finish(self, identity: str, result: dict[str, Any]) -> None:
        with self.connect() as db:
            db.execute("UPDATE jobs SET status='completed',progress=100,stage='Saved and ready',result_json=?,error=NULL,completed_at=?,updated_at=? WHERE id=?",
                       (json.dumps(json_safe(result), allow_nan=False), time.time(), time.time(), identity))

    def fail(self, identity: str, message: str, retry: bool = False) -> None:
        job = self.job(identity)
        with self.connect() as db:
            db.execute("UPDATE jobs SET status=?,stage=?,error=?,progress=0,available_at=?,updated_at=? WHERE id=?",
                       ("queued" if retry else "failed", "Provider retry scheduled" if retry else "Run failed", message,
                        time.time() + 2 ** job["attempts"], time.time(), identity))
