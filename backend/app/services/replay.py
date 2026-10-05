"""A frozen historical prefix; future outcomes are returned only on explicit reveal."""
from __future__ import annotations

from .analytics import add_indicators, technical_snapshot
from .downsampling import largest_triangle_three_buckets
from .prediction import compare_models, date
from .storage import json_safe


def run_replay(history, as_of, progress=None, artifact_dir=None, artifact_prefix="replay"):
    prefix = history[[date(index) <= as_of for index in history.index]].copy()
    if len(prefix) < 180:
        raise ValueError("Choose a replay date with at least 180 earlier daily observations.")
    indicators = add_indicators(prefix)
    predictions = compare_models(prefix, progress, artifact_dir, artifact_prefix)
    points = largest_triangle_three_buckets(indicators, 400, value_column="Close")
    return json_safe({"requested_date": as_of, "as_of": date(prefix.index[-1]), "price": float(prefix["Close"].iloc[-1]),
            "technical": technical_snapshot(indicators), "predictions": predictions,
            "available_steps": min(60, len(history) - len(prefix)), "observations": len(prefix),
            "chart": [{"date": date(index), "close": float(row["Close"]), "volume": int(row["Volume"]),
                       "sma20": float(row["SMA20"]), "sma50": float(row["SMA50"]),
                       "upper_band": float(row["BollingerUpper"]), "lower_band": float(row["BollingerLower"])}
                      for index, row in points.iterrows()],
            "disclaimer": "Historical reconstruction: calculations use only observations on or before the cutoff. The provider's history was retrieved today and may contain later revisions or adjustments; this is not a true point-in-time dataset. Future prices stay hidden until you reveal them."})


def reveal(history, result, steps):
    future = history[[date(index) > result["as_of"] for index in history.index]].head(steps)
    actual = float(future["Close"].iloc[0]) if not future.empty else None
    return {"steps": len(future), "prices": [{"date": date(index), "close": float(row["Close"])} for index, row in future.iterrows()],
            "first_session_actual": actual,
            "forecast_checks": [{"name": model["name"], "forecast": model["latest_prediction"],
                                 "error": actual - model["latest_prediction"] if actual is not None else None,
                                 "inside_interval": model["lower_estimate"] <= actual <= model["upper_estimate"] if actual is not None else None}
                                for model in result["predictions"]["models"]]}
