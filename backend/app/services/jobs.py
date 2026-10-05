"""A bounded, persistent local queue, with one serial research worker."""
from __future__ import annotations

import hashlib
import logging
import threading
import os
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn

from .backtest import run_backtest
from .market_data import fetch_history
from .prediction import compare_models
from .replay import run_replay
from .storage import ResearchStore


SOURCE_VERSION = hashlib.sha256(b"".join((Path(__file__).parent / name).read_bytes() for name in
                                       ["prediction.py", "backtest.py", "replay.py", "jobs.py", "storage.py"])).hexdigest()[:12]
VERSIONS = {"engine": SOURCE_VERSION, "sklearn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__}


class ProviderError(RuntimeError):
    pass


class ResearchWorker:
    def __init__(self, store: ResearchStore):
        self.store = store
        self.stopping = threading.Event()
        self.wake = threading.Event()
        self.thread = threading.Thread(target=self.loop, name="research-worker", daemon=True)
        self.lock_file = None

    def start(self):
        self.lock_file = (self.store.root / "worker.lock").open("a+b")
        if os.fstat(self.lock_file.fileno()).st_size == 0:
            self.lock_file.write(b"0")
            self.lock_file.flush()
        self.lock_file.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.lock_file.close()
            self.lock_file = None
            raise RuntimeError("Another API worker already owns this research database. Use one API process or a separate STOCK_RESEARCH_DIR.") from error
        self.store.recover()
        self.thread.start()

    def stop(self):
        self.stopping.set()
        self.wake.set()
        self.thread.join(timeout=10)
        if self.lock_file and not self.thread.is_alive():
            self.lock_file.close()
            self.lock_file = None

    def loop(self):
        while not self.stopping.is_set():
            try:
                job = self.store.claim()
                if job is None:
                    self.wake.wait(.5)
                    self.wake.clear()
                    continue
                self.execute(job)
            except Exception:
                logging.getLogger(__name__).exception("Research worker error")
                self.stopping.wait(1)

    def dataset(self, symbol, params):
        if params.get("snapshot_id"):
            metadata, history = self.store.snapshot(params["snapshot_id"])
            if metadata["symbol"] != symbol:
                raise ValueError("The saved dataset belongs to a different stock.")
            return metadata, history
        try:
            history = fetch_history(symbol, params["period"], refresh=params.get("refresh_data", False))
        except (ValueError, LookupError):
            raise
        except Exception as error:
            raise ProviderError("The market-data provider is unavailable. Please retry shortly.") from error
        metadata = self.store.save_snapshot(symbol, params["period"], history)
        metadata["fetched_at"] = history.attrs.get("fetched_at")
        return metadata, history

    def execute(self, job):
        identity, params = job["id"], job["params"]
        try:
            results = []
            symbols = params["symbols"]
            for index, symbol in enumerate(symbols):
                def progress(percent, stage):
                    self.store.progress(identity, 10 + int((index + percent / 100) / len(symbols) * 85), f"{symbol} · {stage}")
                self.store.progress(identity, 10 + int(index / len(symbols) * 85), f"{symbol} · Fetching and validating data")
                metadata, history = self.dataset(symbol, params)
                prefix = f"{identity}-{symbol.replace('^', '_').replace('=', '_')}"
                if job["kind"] == "analysis":
                    result = compare_models(history, progress, self.store.artifacts, prefix)
                elif job["kind"] == "replay":
                    result = run_replay(history, params["as_of"], progress, self.store.artifacts, prefix)
                else:
                    result = run_backtest(history, params, progress)
                results.append({"symbol": symbol, "dataset": metadata, **result})
            self.store.finish(identity, {"kind": job["kind"], "versions": VERSIONS, "results": results})
        except Exception as error:
            logging.getLogger(__name__).exception("Research run %s failed", identity)
            retry = isinstance(error, ProviderError) and job["attempts"] < 3
            message = str(error) if isinstance(error, (ValueError, LookupError, ProviderError)) else "Research failed unexpectedly. Check the local API log and retry."
            self.store.fail(identity, message, retry=retry)
