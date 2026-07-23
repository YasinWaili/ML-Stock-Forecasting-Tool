from __future__ import annotations

import math
import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error


FEATURES = [
    "lag_1",
    "lag_2",
    "lag_3",
    "lag_5",
    "return_1",
    "return_5",
    "sma_5",
    "sma_20",
    "volatility_20",
    "volume_change",
]


def _feature_frame(frame: pd.DataFrame) -> pd.DataFrame:
    close = frame["Close"].astype(float)
    volume = frame["Volume"].astype(float)
    features = pd.DataFrame(index=frame.index)
    features["lag_1"] = close
    features["lag_2"] = close.shift(1)
    features["lag_3"] = close.shift(2)
    features["lag_5"] = close.shift(4)
    features["return_1"] = close.pct_change()
    features["return_5"] = close.pct_change(5)
    features["sma_5"] = close.rolling(5).mean()
    features["sma_20"] = close.rolling(20).mean()
    features["volatility_20"] = close.pct_change().rolling(20).std()
    features["volume_change"] = volume.pct_change().replace([np.inf, -np.inf], np.nan)
    features["target"] = close.shift(-1)
    return features


def compare_models(frame: pd.DataFrame) -> dict[str, Any]:
    features = _feature_frame(frame)
    dataset = features.dropna(subset=FEATURES + ["target"]).copy()
    latest_features = features[FEATURES].dropna().tail(1)
    if len(dataset) < 80 or latest_features.empty:
        return {
            "status": "insufficient_data",
            "message": "At least 100 trading days are needed for model evaluation.",
            "models": [],
        }

    split = max(60, int(len(dataset) * 0.80))
    if split >= len(dataset) - 10:
        split = len(dataset) - 10
    train = dataset.iloc[:split]
    test = dataset.iloc[split:]
    x_train, y_train = train[FEATURES], train["target"]
    x_test, y_test = test[FEATURES], test["target"]
    previous_close = test["lag_1"]

    model_specs = [
        ("Linear regression", LinearRegression()),
        (
            "Random forest",
            RandomForestRegressor(
                n_estimators=160,
                max_depth=8,
                min_samples_leaf=3,
                random_state=42,
                n_jobs=-1,
            ),
        ),
    ]
    results: list[dict[str, Any]] = []
    for name, model in model_specs:
        started = time.perf_counter()
        model.fit(x_train, y_train)
        predictions = model.predict(x_test)
        execution_ms = (time.perf_counter() - started) * 1000
        residuals = y_test.to_numpy() - predictions
        residual_std = float(np.std(residuals, ddof=1)) if len(residuals) > 1 else 0.0
        next_price = float(model.predict(latest_features)[0])
        last_close = float(frame["Close"].dropna().iloc[-1])
        directional = np.mean(
            np.sign(predictions - previous_close.to_numpy())
            == np.sign(y_test.to_numpy() - previous_close.to_numpy())
        )
        mae = float(mean_absolute_error(y_test, predictions))
        rmse = float(math.sqrt(mean_squared_error(y_test, predictions)))
        results.append(
            {
                "name": name,
                "mae": mae,
                "rmse": rmse,
                "directional_accuracy": float(directional),
                "latest_prediction": next_price,
                "predicted_change": (next_price / last_close) - 1,
                "lower_estimate": max(0.0, next_price - 1.96 * residual_std),
                "upper_estimate": next_price + 1.96 * residual_std,
                "training_period": f"{train.index[0].date()} to {train.index[-1].date()}",
                "testing_period": f"{test.index[0].date()} to {test.index[-1].date()}",
                "test_observations": len(test),
                "execution_ms": round(execution_ms, 1),
                "status": "Complete",
            }
        )

    best = min(results, key=lambda item: item["rmse"])
    return {
        "status": "complete",
        "best_model": best["name"],
        "models": results,
        "disclaimer": (
            "Experimental one-session estimates based only on historical market data. "
            "Past performance does not guarantee future results, and unexpected events "
            "cannot be inferred from price history."
        ),
    }
