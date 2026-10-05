import json
from types import SimpleNamespace
from threading import Event

import numpy as np
import pandas as pd
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import main
from app.services import jobs, prediction
from app.services.backtest import adjusted_history, run_backtest
from app.services.replay import run_replay, reveal
from app.services.storage import ResearchStore, validate_history


def history(days=400):
    dates = pd.bdate_range("2023-01-02", periods=days)
    close = 100 + np.arange(days) * .1 + np.sin(np.arange(days) / 12) * 5
    return pd.DataFrame({"Open": close - .2, "High": close + 1, "Low": close - 1,
                         "Close": close, "Adj Close": close, "Volume": 1_000_000 + np.arange(days) * 100}, index=dates)


def test_evaluation_is_chronological_and_has_a_baseline(tmp_path):
    result = prediction.compare_models(history(), artifact_dir=tmp_path)
    assert result["status"] == "complete"
    assert result["windows"] == 3
    assert result["models"][0]["name"] == "Last-close baseline"
    for model in result["models"]:
        assert 0 <= model["interval_coverage"] <= 100
        assert 0 <= model["directional_accuracy"] <= 1
        assert np.isfinite(model["rmse"])
        assert len(model["folds"]) == 3
        assert (tmp_path / model["artifact"]["file"]).exists()
        for fold in model["folds"]:
            assert fold["training_target_end"] < fold["calibration_start"]
            assert fold["calibration_target_end"] < fold["test_start"]
    assert result["models"][0]["baseline_improvement"] == 0
    assert result["models"][0]["latest_prediction"] == history()["Close"].iloc[-1]


def test_short_history_explains_why_it_cannot_be_evaluated():
    assert prediction.compare_models(history(100))["status"] == "insufficient_data"


def test_future_prices_do_not_change_replay_forecasts(monkeypatch):
    real_estimator = prediction.estimator
    monkeypatch.setattr(prediction, "estimator", lambda name: real_estimator("Linear regression") if name == "Random forest" else real_estimator(name))
    original = history()
    cutoff = original.index[260].date().isoformat()
    changed = original.copy()
    changed.iloc[261:, changed.columns.get_indexer(["Open", "High", "Low", "Close", "Adj Close"])] *= 9
    first, second = run_replay(original, cutoff), run_replay(changed, cutoff)
    assert first["chart"] == second["chart"]
    assert first["technical"] == second["technical"]
    for a, b in zip(first["predictions"]["models"], second["predictions"]["models"]):
        assert a["latest_prediction"] == b["latest_prediction"]
        assert a["rmse"] == b["rmse"]
        assert a["lower_estimate"] == b["lower_estimate"]
    assert max(point["date"] for point in first["chart"]) <= cutoff
    assert "prices" not in first
    outcome = reveal(original, first, 1)
    assert outcome["prices"][0]["date"] > cutoff
    assert outcome["first_session_actual"] == original["Close"].iloc[261]


def test_replay_needs_sufficient_past_observations():
    with pytest.raises(ValueError, match="180"):
        run_replay(history(), "2023-03-01")


def test_backtest_signals_execute_at_next_open_and_pay_costs():
    frame = history()
    params = {"start_date": frame.index[100].date().isoformat(), "initial_cash": 10000, "fee_bps": 10, "slippage_bps": 20}
    result = run_backtest(frame, params)
    assert result["orders"] > 1
    assert result["total_cost"] > 0
    for order in result["ledger"]:
        if "liquidation" not in order["reason"]:
            assert order["signal_date"] < order["execution_date"]
            opening = frame.loc[order["execution_date"], "Open"]
            assert order["price"] == pytest.approx(opening * (1.002 if order["side"] == "BUY" else .998))
    assert result["curve"][0]["date"] == params["start_date"]
    assert result["metrics"]["maximum_drawdown"] <= 0


def test_costs_reduce_flat_buy_and_hold_equity():
    frame = history()
    for column in ["Open", "High", "Low", "Close", "Adj Close"]:
        frame[column] = 100.
    free = run_backtest(frame, {"fee_bps": 0, "slippage_bps": 0})
    paid = run_backtest(frame, {"fee_bps": 10, "slippage_bps": 10})
    assert free["benchmark_metrics"]["final_equity"] == pytest.approx(10000)
    assert paid["benchmark_metrics"]["final_equity"] < 10000
    assert paid["benchmark_cost"] > 0
    assert paid["benchmark_metrics"]["maximum_drawdown"] < 0


def test_ml_backtest_training_labels_mature_before_execution():
    result = run_backtest(history(), {"strategy": "ml", "fee_bps": 0, "slippage_bps": 0})
    assert result["ledger"]
    for order in result["ledger"]:
        assert order["training_cutoff"] <= order["signal_date"]
        assert order["training_cutoff"] < order["execution_date"]
        assert order["model_version"].startswith("linear-")


def test_corporate_action_adjustment_scales_all_execution_prices():
    frame = history()
    frame["Adj Close"] = frame["Close"] * .5
    adjusted = adjusted_history(frame)
    assert np.allclose(adjusted["Open"], frame["Open"] * .5)
    assert np.allclose(adjusted["Close"], frame["Adj Close"])
    with pytest.raises(ValueError, match="adjusted"):
        adjusted_history(frame.drop(columns="Adj Close"))


def test_storage_reuses_results_and_survives_restarts(tmp_path):
    store = ResearchStore(tmp_path)
    params = {"symbols": ["CIEN"], "period": "1y"}
    first = store.enqueue("analysis", params, "v1")
    assert store.enqueue("analysis", params, "v1")["reused"] is True
    snapshot = store.save_snapshot("CIEN", "1y", history())
    assert store.save_snapshot("CIEN", "1y", history())["id"] == snapshot["id"]
    claimed = store.claim()
    assert claimed["id"] == first["id"]
    store.finish(first["id"], {"value": np.float64(1.5)})
    restarted = ResearchStore(tmp_path)
    assert restarted.job(first["id"])["result"] == {"value": 1.5}
    metadata, restored = restarted.snapshot(snapshot["id"])
    assert metadata["checksum"] == snapshot["checksum"]
    assert np.allclose(restored["Close"], history()["Close"])
    assert restarted.enqueue("analysis", params, "v2")["id"] != first["id"]
    assert restarted.enqueue("analysis", params, "v1", force=True)["id"] != first["id"]


def test_interrupted_jobs_are_requeued(tmp_path):
    store = ResearchStore(tmp_path)
    job = store.enqueue("analysis", {}, "v1")
    store.claim()
    store.progress(job["id"], 45, "Training")
    store.progress(job["id"], 20, "Next stock")
    assert store.job(job["id"])["progress"] == 45
    store.recover()
    assert store.job(job["id"])["status"] == "queued"
    assert store.claim()["attempts"] == 2


def test_only_one_worker_can_own_a_research_database(tmp_path):
    first = jobs.ResearchWorker(ResearchStore(tmp_path))
    second = jobs.ResearchWorker(ResearchStore(tmp_path))
    first.start()
    try:
        with pytest.raises(RuntimeError, match="Another API worker"):
            second.start()
    finally:
        first.stop()


def test_provider_retries_are_bounded(tmp_path, monkeypatch):
    store = ResearchStore(tmp_path)
    worker = jobs.ResearchWorker(store)
    def fail(*args, **kwargs):
        raise OSError("offline")
    monkeypatch.setattr(jobs, "fetch_history", fail)
    job = store.enqueue("analysis", {"symbols": ["CIEN"], "period": "1y"}, "v1")
    for attempt in range(3):
        with store.connect() as db:
            db.execute("UPDATE jobs SET available_at=0 WHERE id=?", (job["id"],))
        worker.execute(store.claim())
        assert store.job(job["id"])["status"] == ("failed" if attempt == 2 else "queued")
    assert store.job(job["id"])["attempts"] == 3


def test_dataset_validation_rejects_bad_prices_and_duplicate_dates():
    invalid = history()
    invalid.iloc[0, invalid.columns.get_loc("Close")] = np.inf
    with pytest.raises(ValueError, match="finite"):
        validate_history(invalid)
    with pytest.raises(ValueError, match="unique"):
        validate_history(pd.concat([history(), history()]).sort_index())


def test_job_api_validates_inputs_and_exports_only_completed_backtests(tmp_path, monkeypatch):
    monkeypatch.setattr(main.app.state, "store", ResearchStore(tmp_path), raising=False)
    monkeypatch.setattr(main.app.state, "worker", SimpleNamespace(wake=Event()), raising=False)
    job = main.create_job(main.ResearchRequest(kind="backtest", symbols=[" cien "]))
    assert job["params"]["symbols"] == ["CIEN"]
    with pytest.raises(HTTPException) as caught:
        main.download_ledger(job["id"])
    assert caught.value.status_code == 409
    with pytest.raises(HTTPException):
        main.create_job(main.ResearchRequest(kind="replay", symbols=["CIEN"]))
    with pytest.raises(ValidationError):
        main.ResearchRequest(kind="backtest", symbols=["CIEN"], initial_cash=float("nan"))
    with pytest.raises(ValidationError):
        main.ResearchRequest(kind="analysis", symbols=["A", "B", "C", "D"])
    assert json.loads(json.dumps(main.list_jobs()))["jobs"][0]["id"] == job["id"]
