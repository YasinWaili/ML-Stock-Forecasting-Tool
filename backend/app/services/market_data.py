from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlencode

import pandas as pd
import yfinance as yf
from curl_cffi import requests

from .cache import TTLCache

# Keep provider cookies beside the app, not in a possibly unwritable user profile.
_provider_cache = Path(__file__).resolve().parents[2] / ".cache" / "yfinance"
_provider_cache.mkdir(parents=True, exist_ok=True)
yf.set_tz_cache_location(str(_provider_cache))

_logo_cache: TTLCache[str, tuple[bytes, str]] = TTLCache(max_size=128, ttl_seconds=86400)
_domains = {"AAPL": "apple.com", "MSFT": "microsoft.com", "NVDA": "nvidia.com",
            "CIEN": "ciena.com", "AMD": "amd.com", "MU": "micron.com",
            "AMZN": "amazon.com", "GOOG": "google.com", "GOOGL": "google.com",
            "META": "meta.com", "TSLA": "tesla.com"}


def company_info(symbol: str) -> dict[str, Any]:
    key = symbol.upper()
    cached = _overview_cache.get(key)
    if cached is not None:
        return cached
    info = yf.Ticker(key).info or {}
    if info:
        _overview_cache.set(key, info)
    return info


def fetch_logo(symbol: str) -> tuple[bytes, str]:
    key = symbol.upper()
    cached = _logo_cache.get(key)
    if cached is not None:
        return cached
    domain = _domains.get(key)
    if not domain:
        domain = urlparse(company_info(key).get("website") or "").hostname
    if not domain:
        raise LookupError("No company logo is available.")
    # Only this fixed image provider is contacted; never proxy arbitrary client URLs.
    response = requests.get("https://www.google.com/s2/favicons?" +
                            urlencode({"domain": domain, "sz": 128}), timeout=8,
                            impersonate="chrome")
    content_type = response.headers.get("content-type", "").split(";")[0]
    if response.status_code != 200 or content_type not in {"image/png", "image/jpeg", "image/x-icon", "image/vnd.microsoft.icon"}:
        raise LookupError("No company logo is available.")
    if not response.content or len(response.content) > 512_000:
        raise LookupError("Invalid company logo.")
    result = (response.content, content_type)
    _logo_cache.set(key, result)
    return result


PERIODS = {
    "1m": "1mo",
    "3mo": "3mo",
    "6mo": "6mo",
    "1y": "1y",
    "5y": "5y",
    "max": "max",
}

_history_cache: TTLCache[tuple[str, str], pd.DataFrame] = TTLCache(
    max_size=48, ttl_seconds=300
)
_search_cache: TTLCache[str, list[dict[str, str]]] = TTLCache(
    max_size=64, ttl_seconds=600
)
_overview_cache: TTLCache[str, dict[str, Any]] = TTLCache(
    max_size=48, ttl_seconds=600
)


def _flatten(frame: pd.DataFrame) -> pd.DataFrame:
    if isinstance(frame.columns, pd.MultiIndex):
        frame = frame.copy()
        frame.columns = frame.columns.get_level_values(0)
    return frame.dropna(subset=["Close"]).sort_index()


def fetch_history(symbol: str, period: str, refresh: bool = False) -> pd.DataFrame:
    if period not in PERIODS:
        raise ValueError(f"Unsupported period '{period}'.")
    cache_key = (symbol.upper(), period)
    cached = _history_cache.get(cache_key)
    if cached is not None and not refresh:
        return cached.copy(deep=False)

    frame = yf.Ticker(symbol).history(
        period=PERIODS[period],
        interval="1d",
        auto_adjust=False,
        actions=True,
        raise_errors=True,
        timeout=12,
    )
    if frame.empty:
        raise LookupError(f"No Yahoo Finance data was found for {symbol}.")
    normalized = _flatten(frame)
    normalized.attrs["fetched_at"] = datetime.now(timezone.utc).isoformat()
    _history_cache.set(cache_key, normalized)
    return normalized.copy(deep=False)


def search_symbols(query: str) -> list[dict[str, str]]:
    cleaned = query.strip()
    if not cleaned:
        return []
    cache_key = cleaned.casefold()
    cached = _search_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        quotes = yf.Search(cleaned, max_results=6, timeout=10).quotes
        results = []
        for quote in quotes:
            if quote.get("quoteType") not in {"EQUITY", "ETF"}:
                continue
            symbol = quote.get("symbol")
            if not symbol:
                continue
            results.append(
                {
                    "symbol": symbol,
                    "name": quote.get("shortname") or quote.get("longname") or symbol,
                    "exchange": quote.get("exchDisp") or quote.get("exchange") or "",
                    "type": quote.get("quoteType") or "",
                    "logo_url": f"/api/stocks/{symbol}/logo",
                }
            )
        _search_cache.set(cache_key, results)
        return results
    except Exception as error:
        raise RuntimeError("Company search is temporarily unavailable.") from error


def fetch_overview(symbol: str, frame: pd.DataFrame) -> dict[str, Any]:
    try:
        info = company_info(symbol)
    except Exception:
        info = {}

    close = frame["Close"].astype(float)
    latest = float(close.iloc[-1])
    previous = float(close.iloc[-2]) if len(close) > 1 else latest
    last_row = frame.iloc[-1]
    recent_year = frame.tail(252)
    currency = info.get("currency") or "USD"
    logo_url = f"/api/stocks/{symbol.upper()}/logo"
    return {
        "symbol": symbol.upper(),
        "name": info.get("longName") or info.get("shortName") or symbol.upper(),
        "price": latest,
        "change": latest - previous,
        "change_percent": (latest / previous - 1) if previous else 0,
        "previous_close": previous,
        "open": float(last_row["Open"]),
        "day_high": float(last_row["High"]),
        "day_low": float(last_row["Low"]),
        "volume": int(last_row["Volume"]),
        "average_volume": int(info.get("averageVolume") or frame["Volume"].tail(30).mean()),
        "market_cap": int(info.get("marketCap") or 0),
        "week_52_high": float(info.get("fiftyTwoWeekHigh") or recent_year["High"].max()),
        "week_52_low": float(info.get("fiftyTwoWeekLow") or recent_year["Low"].min()),
        "sector": info.get("sector") or "—",
        "industry": info.get("industry") or "—",
        "exchange": info.get("fullExchangeName") or info.get("exchange") or "—",
        "currency": currency,
        "logo_url": logo_url,
        "market_state": info.get("marketState") or "UNKNOWN",
        "as_of": frame.index[-1].date().isoformat(),
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance",
    }
