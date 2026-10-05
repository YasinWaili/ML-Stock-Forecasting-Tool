"""Chronological, one-session forecasts with independent interval calibration."""
from __future__ import annotations

import hashlib
import time
from pathlib import Path
from typing import Callable

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import TimeSeriesSplit
from threadpoolctl import threadpool_limits

MAX_MODEL_OBSERVATIONS = 2_500
FEATURES = ["lag_1", "lag_2", "lag_3", "lag_5", "return_1", "return_5", "sma_5", "sma_20", "volatility_20", "volume_change"]
MODEL_NAMES = ["Last-close baseline", "Linear regression", "Random forest"]


def feature_frame(history: pd.DataFrame) -> pd.DataFrame:
    close = history["Close"].astype(float)
    frame = pd.DataFrame(index=history.index)
    for name, offset in [("lag_1", 0), ("lag_2", 1), ("lag_3", 2), ("lag_5", 4)]:
        frame[name] = close.shift(offset)
    frame["return_1"] = close.pct_change()
    frame["return_5"] = close.pct_change(5)
    frame["sma_5"] = close.rolling(5).mean()
    frame["sma_20"] = close.rolling(20).mean()
    frame["volatility_20"] = close.pct_change().rolling(20).std()
    frame["volume_change"] = history["Volume"].pct_change().replace([np.inf, -np.inf], np.nan).fillna(0)
    frame["target"] = close.shift(-1)
    frame["target_date"] = pd.Series(history.index, index=history.index).shift(-1)
    return frame


def estimator(name: str):
    if name == "Linear regression":
        return LinearRegression()
    if name == "Random forest":
        # One CPU thread: the API and charts must remain usable during training.
        return RandomForestRegressor(n_estimators=80, max_depth=8, min_samples_leaf=3, random_state=42, n_jobs=1)
    return None


def predict(model, features: pd.DataFrame) -> np.ndarray:
    return features["lag_1"].to_numpy() if model is None else model.predict(features[FEATURES])


def calibrated_fit(name: str, train: pd.DataFrame):
    count = min(60, max(20, len(train) // 5))
    # The dropped boundary row prevents its next-session label crossing the split.
    fit, calibration = train.iloc[:-count - 1], train.iloc[-count:]
    if len(fit) < 50:
        raise ValueError("Not enough observations for independent training and calibration.")
    model = estimator(name)
    if model is not None:
        model.fit(fit[FEATURES], fit["target"])
    residuals = np.abs(calibration["target"].to_numpy() - predict(model, calibration))
    quantile = min(1.0, np.ceil((len(residuals) + 1) * .95) / len(residuals))
    radius = float(np.quantile(residuals, quantile, method="higher"))
    return model, radius, fit, calibration


def metrics(actual, forecast, previous, radius) -> dict:
    actual, forecast, previous, radius = map(np.asarray, (actual, forecast, previous, radius))
    errors = actual - forecast
    return {"mae": float(np.mean(np.abs(errors))), "rmse": float(np.sqrt(np.mean(errors ** 2))),
            "directional_accuracy": float(np.mean(np.sign(actual - previous) == np.sign(forecast - previous))),
            "interval_coverage": float(np.mean(np.abs(errors) <= radius) * 100),
            "mean_interval_width": float(np.mean(radius) * 2)}


def date(value) -> str:
    return pd.Timestamp(value).date().isoformat()


@threadpool_limits.wrap(limits=1)
def compare_models(history: pd.DataFrame, progress: Callable[[int, str], None] | None = None,
                   artifact_dir: Path | None = None, artifact_prefix: str = "model") -> dict:
    started = time.perf_counter()
    features = feature_frame(history)
    dataset = features.dropna(subset=FEATURES + ["target", "target_date"]).tail(MAX_MODEL_OBSERVATIONS)
    test_size = min(60, (len(dataset) - 110) // 3)
    if test_size < 10:
        return {"status": "insufficient_data", "models": [], "best_model": None,
                "message": "Use at least 180 daily observations for the evaluation lab.",
                "disclaimer": "Experimental forecasts, not investment advice."}
    splits = list(TimeSeriesSplit(n_splits=3, test_size=test_size, gap=1).split(dataset))
    latest = features.dropna(subset=FEATURES).tail(1)
    last_close = float(history["Close"].iloc[-1])
    results = []
    for model_index, name in enumerate(MODEL_NAMES):
        model_started = time.perf_counter()
        actuals, forecasts, previous, radii, folds = [], [], [], [], []
        for fold_index, (train_indices, test_indices) in enumerate(splits):
            train, test = dataset.iloc[train_indices], dataset.iloc[test_indices]
            model, radius, fit, calibration = calibrated_fit(name, train)
            forecast = predict(model, test)
            actuals.extend(test["target"].tolist())
            forecasts.extend(forecast.tolist())
            previous.extend(test["lag_1"].tolist())
            radii.extend([radius] * len(test))
            folds.append({"fold": fold_index + 1, "training_start": date(fit.index[0]),
                          "training_target_end": date(fit["target_date"].iloc[-1]),
                          "calibration_start": date(calibration.index[0]),
                          "calibration_target_end": date(calibration["target_date"].iloc[-1]),
                          "test_start": date(test.index[0]), "test_end": date(test["target_date"].iloc[-1]),
                          "observations": len(test), **metrics(test["target"], forecast, test["lag_1"], [radius] * len(test))})
            if progress:
                progress(int((model_index * 3 + fold_index + 1) / 10 * 100), f"{name} · window {fold_index + 1}/3")
        model, radius, fit, calibration = calibrated_fit(name, dataset)
        latest_prediction = float(predict(model, latest)[0])
        artifact = None
        if artifact_dir is not None:
            filename = f"{artifact_prefix}-{model_index}.joblib"
            path = artifact_dir / filename
            joblib.dump({"model": model, "features": FEATURES, "radius": radius, "seed": 42,
                         "training_target_end": date(fit["target_date"].iloc[-1]),
                         "calibration_target_end": date(calibration["target_date"].iloc[-1])}, path)
            artifact = {"file": filename, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        results.append({"name": name, **metrics(actuals, forecasts, previous, radii),
                        "normalized_rmse": float(np.sqrt(np.mean((np.asarray(actuals) - forecasts) ** 2)) / np.mean(actuals) * 100),
                        "latest_prediction": latest_prediction, "predicted_change": latest_prediction / last_close - 1,
                        "lower_estimate": max(0, latest_prediction - radius), "upper_estimate": latest_prediction + radius,
                        "training_period": f"{date(fit.index[0])} — {date(fit['target_date'].iloc[-1])}",
                        "calibration_period": f"{date(calibration.index[0])} — {date(calibration['target_date'].iloc[-1])}",
                        "testing_period": f"{folds[0]['test_start']} — {folds[-1]['test_end']}",
                        "test_observations": len(actuals), "execution_ms": (time.perf_counter() - model_started) * 1000,
                        "folds": folds, "artifact": artifact, "status": "complete",
                        "hyperparameters": model.get_params() if model is not None else {"rule": "next close equals latest close"}})
    baseline_rmse = results[0]["rmse"]
    for result in results:
        result["baseline_improvement"] = (1 - result["rmse"] / baseline_rmse) * 100 if baseline_rmse else None
    return {"status": "complete", "models": results, "best_model": min(results, key=lambda item: item["rmse"])["name"],
            "method": "Expanding-window evaluation", "windows": 3, "gap_sessions": 1,
            "forecast_horizon_sessions": 1, "nominal_interval_coverage": 95, "seed": 42, "feature_names": FEATURES,
            "observations": len(dataset), "execution_ms": (time.perf_counter() - started) * 1000,
            "disclaimer": "Experimental one-session forecasts. Intervals use separate past calibration data; 95% coverage is a target, not a guarantee. Daily features are observed at the close; these are not executable same-close prices."}
