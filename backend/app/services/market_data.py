from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pandas as pd
import yfinance as yf


PERIODS = {
    "1m": "1mo",
    "3mo": "3mo",
    "6mo": "6mo",
    "1y": "1y",
    "5y": "5y",
    "max": "max",
}


def _flatten(frame: pd.DataFrame) -> pd.DataFrame:
    if isinstance(frame.columns, pd.MultiIndex):
        frame = frame.copy()
        frame.columns = frame.columns.get_level_values(0)
    return frame.dropna(subset=["Close"]).sort_index()


def fetch_history(symbol: str, period: str) -> pd.DataFrame:
    if period not in PERIODS:
        raise ValueError(f"Unsupported period '{period}'.")
    frame = yf.download(
        symbol,
        period=PERIODS[period],
        interval="1d",
        auto_adjust=False,
        progress=False,
        threads=False,
    )
    if frame.empty:
        raise LookupError(f"No Yahoo Finance data was found for {symbol}.")
    return _flatten(frame)


def search_symbols(query: str) -> list[dict[str, str]]:
    cleaned = query.strip()
    if not cleaned:
        return []
    try:
        quotes = yf.Search(cleaned, max_results=6).quotes
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
                    "exchange": quote.get("exchange") or "",
                    "type": quote.get("quoteType") or "",
                }
            )
        if results:
            return results
    except Exception:
        pass
    return [{"symbol": cleaned.upper(), "name": cleaned.upper(), "exchange": "", "type": "EQUITY"}]


def fetch_overview(symbol: str, frame: pd.DataFrame) -> dict[str, Any]:
    ticker = yf.Ticker(symbol)
    try:
        info = ticker.info or {}
    except Exception:
        info = {}

    close = frame["Close"].astype(float)
    latest = float(close.iloc[-1])
    previous = float(close.iloc[-2]) if len(close) > 1 else latest
    last_row = frame.iloc[-1]
    recent_year = frame.tail(252)
    currency = info.get("currency") or "USD"
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
        "exchange": info.get("exchange") or info.get("fullExchangeName") or "—",
        "currency": currency,
        "logo_url": info.get("logo_url") or "",
        "market_state": info.get("marketState") or "CLOSED",
        "as_of": frame.index[-1].date().isoformat(),
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance",
    }
