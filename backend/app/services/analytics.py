from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

TRADING_DAYS = 252


def _finite(value: float | int | np.number | None, default: float = 0.0) -> float:
    if value is None:
        return default
    number = float(value)
    return number if math.isfinite(number) else default


def add_indicators(frame: pd.DataFrame) -> pd.DataFrame:
    data = frame.copy()
    close = data["Close"].astype(float)
    high = data["High"].astype(float)
    low = data["Low"].astype(float)

    data["Return"] = close.pct_change()
    data["SMA20"] = close.rolling(20).mean()
    data["SMA50"] = close.rolling(50).mean()
    data["EMA12"] = close.ewm(span=12, adjust=False).mean()
    data["EMA26"] = close.ewm(span=26, adjust=False).mean()
    data["MACD"] = data["EMA12"] - data["EMA26"]
    data["MACDSignal"] = data["MACD"].ewm(span=9, adjust=False).mean()

    delta = close.diff()
    gains = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    losses = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    relative_strength = gains / losses.replace(0, np.nan)
    data["RSI"] = (100 - (100 / (1 + relative_strength))).fillna(50)

    rolling_std = close.rolling(20).std()
    data["BollingerUpper"] = data["SMA20"] + (rolling_std * 2)
    data["BollingerLower"] = data["SMA20"] - (rolling_std * 2)

    previous_close = close.shift(1)
    true_range = pd.concat(
        [
            high - low,
            (high - previous_close).abs(),
            (low - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    data["ATR"] = true_range.rolling(14).mean()
    data["Momentum"] = close.pct_change(10)
    data["Volatility20"] = data["Return"].rolling(20).std() * np.sqrt(TRADING_DAYS)
    return data


def calculate_statistics(
    frame: pd.DataFrame, benchmark: pd.DataFrame | None = None
) -> dict[str, float]:
    close = frame["Close"].astype(float).dropna()
    returns = close.pct_change().dropna()
    if len(close) < 2 or returns.empty:
        raise ValueError("At least two valid closing prices are required.")

    cumulative_return = (close.iloc[-1] / close.iloc[0]) - 1
    years = max(len(returns) / TRADING_DAYS, 1 / TRADING_DAYS)
    annualized_return = (1 + cumulative_return) ** (1 / years) - 1
    daily_volatility = returns.std(ddof=1)
    annualized_volatility = daily_volatility * np.sqrt(TRADING_DAYS)
    running_peak = close.cummax()
    drawdown = (close / running_peak) - 1
    max_drawdown = drawdown.min()

    downside = returns[returns < 0]
    downside_deviation = downside.std(ddof=1) * np.sqrt(TRADING_DAYS)
    sharpe = (
        returns.mean() / returns.std(ddof=1) * np.sqrt(TRADING_DAYS)
        if returns.std(ddof=1)
        else 0
    )
    sortino = (
        returns.mean() / downside.std(ddof=1) * np.sqrt(TRADING_DAYS)
        if not downside.empty and downside.std(ddof=1)
        else 0
    )
    calmar = annualized_return / abs(max_drawdown) if max_drawdown else 0
    value_at_risk = returns.quantile(0.05)
    tail = returns[returns <= value_at_risk]
    expected_shortfall = tail.mean() if not tail.empty else value_at_risk

    beta = 0.0
    correlation = 0.0
    if benchmark is not None and not benchmark.empty:
        benchmark_returns = benchmark["Close"].astype(float).pct_change().rename("benchmark")
        aligned = pd.concat([returns.rename("stock"), benchmark_returns], axis=1).dropna()
        if len(aligned) > 2 and aligned["benchmark"].var():
            beta = aligned["stock"].cov(aligned["benchmark"]) / aligned["benchmark"].var()
            correlation = aligned["stock"].corr(aligned["benchmark"])

    return {
        "cumulative_return": _finite(cumulative_return),
        "average_daily_return": _finite(returns.mean()),
        "annualized_return": _finite(annualized_return),
        "daily_volatility": _finite(daily_volatility),
        "annualized_volatility": _finite(annualized_volatility),
        "standard_deviation": _finite(returns.std(ddof=1)),
        "maximum_drawdown": _finite(max_drawdown),
        "sharpe_ratio": _finite(sharpe),
        "sortino_ratio": _finite(sortino),
        "calmar_ratio": _finite(calmar),
        "value_at_risk_95": _finite(value_at_risk),
        "expected_shortfall_95": _finite(expected_shortfall),
        "downside_deviation": _finite(downside_deviation),
        "benchmark_correlation": _finite(correlation),
        "beta": _finite(beta),
    }


def technical_snapshot(indicators: pd.DataFrame) -> dict[str, Any]:
    latest = indicators.dropna(subset=["Close"]).iloc[-1]
    recent = indicators.tail(60)
    score = 0
    reasons: list[str] = []

    if pd.notna(latest["SMA20"]):
        above_sma20 = latest["Close"] > latest["SMA20"]
        score += 1 if above_sma20 else -1
        reasons.append(
            f"Price is {'above' if above_sma20 else 'below'} the 20-day average."
        )
    if pd.notna(latest["SMA50"]):
        above_sma50 = latest["Close"] > latest["SMA50"]
        score += 1 if above_sma50 else -1
        reasons.append(
            f"Price is {'above' if above_sma50 else 'below'} the 50-day average."
        )

    rsi = _finite(latest.get("RSI"), 50)
    if rsi > 70:
        score -= 1
        reasons.append("RSI is in historically overbought territory.")
    elif rsi < 30:
        score += 1
        reasons.append("RSI is in historically oversold territory.")
    else:
        reasons.append("RSI is in a neutral range.")

    macd = _finite(latest.get("MACD"))
    macd_signal = _finite(latest.get("MACDSignal"))
    score += 1 if macd > macd_signal else -1
    reasons.append(
        f"MACD is {'above' if macd > macd_signal else 'below'} its signal line."
    )

    labels = {
        -4: "Bearish",
        -3: "Bearish",
        -2: "Slightly bearish",
        -1: "Slightly bearish",
        0: "Neutral",
        1: "Slightly bullish",
        2: "Slightly bullish",
        3: "Bullish",
        4: "Bullish",
    }

    golden_cross = False
    death_cross = False
    cross_data = indicators[["SMA20", "SMA50"]].dropna()
    if len(cross_data) >= 2:
        prior, current = cross_data.iloc[-2], cross_data.iloc[-1]
        golden_cross = prior["SMA20"] <= prior["SMA50"] and current["SMA20"] > current["SMA50"]
        death_cross = prior["SMA20"] >= prior["SMA50"] and current["SMA20"] < current["SMA50"]

    return {
        "signal": labels[max(-4, min(4, score))],
        "signal_score": score,
        "rsi": rsi,
        "macd": macd,
        "macd_signal": macd_signal,
        "sma_20": _finite(latest.get("SMA20")),
        "sma_50": _finite(latest.get("SMA50")),
        "atr": _finite(latest.get("ATR")),
        "momentum_10d": _finite(latest.get("Momentum")),
        "support": _finite(recent["Low"].quantile(0.10)),
        "resistance": _finite(recent["High"].quantile(0.90)),
        "golden_cross": bool(golden_cross),
        "death_cross": bool(death_cross),
        "reasons": reasons,
    }


def risk_assessment(statistics: dict[str, float], indicators: pd.DataFrame) -> dict[str, Any]:
    recent_volatility = _finite(indicators["Return"].tail(20).std() * np.sqrt(TRADING_DAYS))
    long_volatility = statistics["annualized_volatility"]
    volatility_score = min(100.0, long_volatility / 0.60 * 100)
    drawdown_score = min(100.0, abs(statistics["maximum_drawdown"]) / 0.60 * 100)
    beta_score = min(100.0, abs(statistics["beta"]) / 2.0 * 100)
    var_score = min(100.0, abs(statistics["value_at_risk_95"]) / 0.06 * 100)
    downside_score = min(100.0, statistics["downside_deviation"] / 0.45 * 100)
    regime_score = min(100.0, max(0.0, (recent_volatility / max(long_volatility, 0.01) - 0.7) * 100))

    score = (
        volatility_score * 0.28
        + drawdown_score * 0.26
        + beta_score * 0.14
        + var_score * 0.14
        + downside_score * 0.12
        + regime_score * 0.06
    )
    classification = (
        "Low"
        if score < 28
        else "Moderate"
        if score < 52
        else "High"
        if score < 74
        else "Very high"
    )
    return {
        "score": round(score, 1),
        "classification": classification,
        "volatility_score": round(volatility_score, 1),
        "drawdown_score": round(drawdown_score, 1),
        "beta_score": round(beta_score, 1),
        "value_at_risk_score": round(var_score, 1),
        "recent_annualized_volatility": recent_volatility,
        "formula": "28% volatility + 26% drawdown + 14% beta + 14% VaR + 12% downside deviation + 6% volatility regime",
    }
