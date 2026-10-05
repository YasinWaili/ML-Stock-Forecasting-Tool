from __future__ import annotations

import math
import re
import logging
import csv
import io
import json
from contextlib import asynccontextmanager
from datetime import date
from typing import Literal
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, ConfigDict, Field

from .services.analytics import (
    add_indicators,
    calculate_statistics,
    risk_assessment,
    technical_snapshot,
)
from .services.insights import create_insights
from .services.cache import TTLCache
from .services.downsampling import largest_triangle_three_buckets
from .services.market_data import fetch_history, fetch_overview, search_symbols, fetch_logo
from .services.jobs import ResearchWorker, VERSIONS
from .services.storage import ResearchStore
from .services.replay import reveal


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.store = ResearchStore()
    application.state.worker = ResearchWorker(application.state.store)
    application.state.worker.start()
    yield
    application.state.worker.stop()

app = FastAPI(
    title="Stock Analysis API",
    version="0.2.0",
    lifespan=lifespan,
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
    return {"status": "ok", "version": "0.2.0"}


@app.get("/api/stocks/search")
def search_stocks(q: str = Query(min_length=1, max_length=80)) -> dict[str, Any]:
    try:
        return {"query": q, "results": search_symbols(q)}
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


def normalize_symbol(symbol: str) -> str:
    normalized = symbol.strip().upper()
    if not re.fullmatch(r"[A-Z0-9^][A-Z0-9.^=\-]{0,19}", normalized):
        raise HTTPException(status_code=400, detail="Enter a valid ticker symbol.")
    return normalized


@app.get("/api/stocks/{symbol}/logo")
def stock_logo(symbol: str) -> Response:
    normalized = normalize_symbol(symbol)
    try:
        content, media_type = fetch_logo(normalized)
        return Response(content, media_type=media_type,
                        headers={"Cache-Control": "public, max-age=86400"})
    except Exception as error:
        raise HTTPException(status_code=404, detail="Company logo unavailable.") from error


@app.get("/api/stocks/{symbol}/dashboard")
def stock_dashboard(
    symbol: str,
    period: str = "1y",
    max_points: int = Query(default=650, ge=200, le=1_200),
) -> dict[str, Any]:
    normalized = normalize_symbol(symbol)
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
        predictions = {"status": "pending", "models": [], "message": "Model evaluation runs separately in the background research queue."}
        insights = create_insights(overview, statistics, technical, risk, predictions)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        logging.getLogger(__name__).exception("Market data request failed for %s", normalized)
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


class ResearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["analysis", "replay", "backtest"]
    symbols: list[str] = Field(min_length=1, max_length=3)
    period: Literal["1y", "5y", "max"] = "5y"
    snapshot_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{24}$")
    as_of: date | None = None
    start_date: date | None = None
    end_date: date | None = None
    initial_cash: float = Field(default=10_000, ge=100, le=1_000_000_000, allow_inf_nan=False)
    fee_bps: float = Field(default=5, ge=0, le=100, allow_inf_nan=False)
    slippage_bps: float = Field(default=5, ge=0, le=100, allow_inf_nan=False)
    strategy: Literal["sma", "ml"] = "sma"
    force: bool = False


@app.post("/api/jobs", status_code=202)
def create_job(body: ResearchRequest) -> dict[str, Any]:
    symbols = list(dict.fromkeys(normalize_symbol(symbol) for symbol in body.symbols))
    if body.kind != "analysis" and len(symbols) != 1:
        raise HTTPException(400, "Replay and backtesting run on one stock at a time.")
    if body.snapshot_id and len(symbols) != 1:
        raise HTTPException(400, "A saved dataset belongs to one stock.")
    if body.kind == "replay" and body.as_of is None:
        raise HTTPException(400, "Choose a historical replay date.")
    if body.start_date and body.end_date and body.start_date > body.end_date:
        raise HTTPException(400, "The start date must be before the end date.")
    params = body.model_dump(mode="json", exclude={"kind", "force"})
    params["symbols"] = symbols
    params["refresh_data"] = body.force
    try:
        job = app.state.store.enqueue(body.kind, params, json.dumps(VERSIONS, sort_keys=True), body.force)
        app.state.worker.wake.set()
        return job
    except OverflowError as error:
        raise HTTPException(429, str(error)) from error


@app.get("/api/jobs")
def list_jobs() -> dict[str, Any]:
    return {"jobs": app.state.store.list_jobs()}


def saved_job(identity: str) -> dict[str, Any]:
    if not re.fullmatch(r"[a-f0-9]{32}", identity):
        raise HTTPException(404, "Research run not found.")
    try:
        return app.state.store.job(identity)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@app.get("/api/jobs/{identity}")
def get_job(identity: str) -> dict[str, Any]:
    return saved_job(identity)


@app.get("/api/replays/{identity}/reveal")
def reveal_replay(identity: str, steps: int = Query(default=1, ge=1, le=60)) -> dict[str, Any]:
    job = saved_job(identity)
    if job["kind"] != "replay" or job["status"] != "completed":
        raise HTTPException(409, "Complete a replay before revealing its outcome.")
    result = job["result"]["results"][0]
    _, history = app.state.store.snapshot(result["dataset"]["id"])
    return _safe(reveal(history, result, steps))


@app.get("/api/jobs/{identity}/ledger")
def download_ledger(identity: str) -> Response:
    job = saved_job(identity)
    if job["kind"] != "backtest" or job["status"] != "completed":
        raise HTTPException(409, "Complete a backtest before exporting its ledger.")
    rows = job["result"]["results"][0]["ledger"]
    fields = ["signal_date", "execution_date", "side", "units", "price", "fee", "slippage_cost", "cash_after", "reason", "model_version", "training_cutoff"]
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return Response(buffer.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="backtest-{identity[:8]}.csv"'})
