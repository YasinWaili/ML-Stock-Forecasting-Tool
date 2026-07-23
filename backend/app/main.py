from __future__ import annotations

import math
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .services.analytics import (
    add_indicators,
    calculate_statistics,
    risk_assessment,
    technical_snapshot,
)
from .services.insights import create_insights
from .services.cache import TTLCache
from .services.downsampling import largest_triangle_three_buckets
from .services.market_data import fetch_history, fetch_overview, search_symbols
from .services.prediction import compare_models

app = FastAPI(
    title="Northstar Stock Intelligence API",
    version="0.1.0",
    description="Local-first market data, analytics, risk, and forecasting API.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1_000, compresslevel=5)

_dashboard_cache: TTLCache[tuple[str, str, int], dict[str, Any]] = TTLCache(
    max_size=32, ttl_seconds=180
)


def _safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_safe(item) for item in value]
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/stocks/search")
def search_stocks(q: str = Query(min_length=1, max_length=80)) -> dict[str, Any]:
    return {"query": q, "results": search_symbols(q)}


@app.get("/api/stocks/{symbol}/dashboard")
def stock_dashboard(
    symbol: str,
    period: str = "1y",
    max_points: int = Query(default=650, ge=200, le=1_200),
) -> dict[str, Any]:
    normalized = symbol.strip().upper()
    if not normalized or len(normalized) > 12:
        raise HTTPException(status_code=400, detail="Enter a valid ticker symbol.")
    cache_key = (normalized, period, max_points)
    cached = _dashboard_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        history = fetch_history(normalized, period)
        try:
            benchmark = fetch_history("SPY", period)
        except Exception:
            benchmark = None
        indicators = add_indicators(history)
        overview = fetch_overview(normalized, history)
        statistics = calculate_statistics(history, benchmark)
        technical = technical_snapshot(indicators)
        risk = risk_assessment(statistics, indicators)
        predictions = compare_models(history)
        insights = create_insights(overview, statistics, technical, risk, predictions)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail="Market data is temporarily unavailable. Please try again shortly.",
        ) from error

    chart_source = largest_triangle_three_buckets(
        indicators, max_points, value_column="Close"
    )
    chart = []
    for index, row in chart_source.iterrows():
        chart.append(
            {
                "date": index.date().isoformat(),
                "close": float(row["Close"]),
                "volume": int(row["Volume"]),
                "sma20": None if math.isnan(row["SMA20"]) else float(row["SMA20"]),
                "sma50": None if math.isnan(row["SMA50"]) else float(row["SMA50"]),
                "upper_band": None
                if math.isnan(row["BollingerUpper"])
                else float(row["BollingerUpper"]),
                "lower_band": None
                if math.isnan(row["BollingerLower"])
                else float(row["BollingerLower"]),
            }
        )

    response = _safe(
        {
            "overview": overview,
            "statistics": statistics,
            "technical": technical,
            "risk": risk,
            "predictions": predictions,
            "insights": insights,
            "chart": chart,
            "period": period,
            "performance": {
                "source_points": len(indicators),
                "rendered_points": len(chart),
                "sampling": "largest-triangle-three-buckets",
                "model_observation_limit": 2_500,
            },
        }
    )
    _dashboard_cache.set(cache_key, response)
    return response
