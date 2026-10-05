"""Long-only daily simulation: yesterday's signal, today's open, explicit costs."""
from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from threadpoolctl import threadpool_limits

from .downsampling import largest_triangle_three_buckets
from .prediction import FEATURES, MAX_MODEL_OBSERVATIONS, date, feature_frame


def adjusted_history(history: pd.DataFrame) -> pd.DataFrame:
    if "Adj Close" not in history:
        raise ValueError("Backtesting requires adjusted prices to account for corporate actions.")
    factor = history["Adj Close"] / history["Close"]
    if not np.isfinite(factor).all() or (factor <= 0).any():
        raise ValueError("Adjusted price history is incomplete.")
    frame = history.copy()
    for column in ["Open", "High", "Low", "Close"]:
        frame[column] = history[column] * factor
    return frame


def equity_metrics(values: list[float], initial: float) -> dict:
    series = pd.Series([initial, *values], dtype=float)
    returns = series.pct_change().dropna()
    volatility = float(returns.std(ddof=0))
    return {"total_return": (values[-1] / initial - 1) * 100,
            "maximum_drawdown": float((series / series.cummax() - 1).min()) * 100,
            "annualized_volatility": volatility * np.sqrt(252) * 100,
            "sharpe_ratio": float(returns.mean() / volatility * np.sqrt(252)) if volatility > 1e-12 else 0,
            "final_equity": values[-1]}


@threadpool_limits.wrap(limits=1)
def run_backtest(history: pd.DataFrame, params: dict, progress: Callable[[int, str], None] | None = None) -> dict:
    frame = adjusted_history(history)
    if len(frame) < 80:
        raise ValueError("Backtesting needs at least 80 daily observations, including warm-up.")
    start = params.get("start_date") or date(frame.index[max(60, len(frame) - 252)])
    end = params.get("end_date") or date(frame.index[-1])
    dates = pd.Index([date(value) for value in frame.index])
    indices = [i for i, value in enumerate(dates) if start <= value <= end]
    if not indices or indices[0] < 60 or len(indices) < 20:
        raise ValueError("Choose at least 20 sessions, with 60 earlier sessions available for warm-up.")
    if len(indices) > 1_250:
        raise ValueError("Limit a backtest to 1,250 trading sessions (about five years).")
    initial = float(params.get("initial_cash", 10_000))
    fee_rate, slip_rate = float(params.get("fee_bps", 5)) / 10_000, float(params.get("slippage_bps", 5)) / 10_000
    strategy = params.get("strategy", "sma")
    features = feature_frame(frame)
    sma20, sma50 = frame["Close"].rolling(20).mean(), frame["Close"].rolling(50).mean()
    cash, units, benchmark_cash, benchmark_units = initial, 0., initial, 0.
    ledger, curve = [], []
    model, model_version, training_cutoff = None, None, None
    total_cost = benchmark_cost = 0.

    def execute(cash_value, unit_value, side, raw_price):
        execution = raw_price * (1 + slip_rate if side == "BUY" else 1 - slip_rate)
        if side == "BUY":
            quantity = cash_value / (execution * (1 + fee_rate))
            fee = quantity * execution * fee_rate
            return 0., quantity, execution, fee, quantity * abs(execution - raw_price)
        fee = unit_value * execution * fee_rate
        return unit_value * execution - fee, 0., execution, fee, unit_value * abs(execution - raw_price)

    def order(side, raw_price, signal_index, execution_index, reason):
        nonlocal cash, units, total_cost
        quantity = units
        cash, units, execution, fee, slippage = execute(cash, units, side, raw_price)
        total_cost += fee + slippage
        ledger.append({"signal_date": date(frame.index[signal_index]), "execution_date": date(frame.index[execution_index]),
                       "side": side, "units": units if side == "BUY" else quantity, "price": execution,
                       "fee": fee, "slippage_cost": slippage, "cash_after": cash, "reason": reason,
                       "model_version": model_version, "training_cutoff": training_cutoff})

    for step, i in enumerate(indices):
        signal_i = i - 1
        desired = bool(sma20.iloc[signal_i] > sma50.iloc[signal_i])
        if strategy == "ml":
            if model is None or step % 20 == 0:
                train = features[(features["target_date"] <= frame.index[signal_i])].dropna(subset=FEATURES + ["target"]).tail(MAX_MODEL_OBSERVATIONS)
                if len(train) < 60:
                    raise ValueError("The ML strategy needs at least 80 earlier daily observations.")
                model = LinearRegression().fit(train[FEATURES], train["target"])
                model_version = f"linear-{step // 20 + 1}"
                training_cutoff = date(train["target_date"].iloc[-1])
            forecast = float(model.predict(features.iloc[[signal_i]][FEATURES])[0])
            desired = forecast > float(frame["Close"].iloc[signal_i]) * (1 + 2 * (fee_rate + slip_rate))
        opening = float(frame["Open"].iloc[i])
        if step == 0:
            benchmark_cash, benchmark_units, _, fee, slip = execute(benchmark_cash, benchmark_units, "BUY", opening)
            benchmark_cost += fee + slip
        if desired and units == 0:
            order("BUY", opening, signal_i, i, "Prior-close signal; next-open execution")
        elif not desired and units > 0:
            order("SELL", opening, signal_i, i, "Prior-close signal; next-open execution")
        closing = float(frame["Close"].iloc[i])
        if step == len(indices) - 1:
            if units > 0:
                order("SELL", closing, i, i, "End-of-window liquidation at close")
            benchmark_cash, benchmark_units, _, fee, slip = execute(benchmark_cash, benchmark_units, "SELL", closing)
            benchmark_cost += fee + slip
        curve.append({"date": date(frame.index[i]), "equity": cash + units * closing,
                      "benchmark": benchmark_cash + benchmark_units * closing})
        if progress and (step % 20 == 0 or step == len(indices) - 1):
            progress(int((step + 1) / len(indices) * 100), f"Simulating session {step + 1}/{len(indices)}")
    sampled = pd.DataFrame(curve).set_index("date")
    sampled.index = pd.to_datetime(sampled.index)
    sampled = largest_triangle_three_buckets(sampled, 650, value_column="equity")
    return {"strategy": strategy, "start_date": curve[0]["date"], "end_date": curve[-1]["date"],
            "sessions": len(curve), "initial_cash": initial, "fee_bps": fee_rate * 10_000,
            "slippage_bps": slip_rate * 10_000, "metrics": equity_metrics([row["equity"] for row in curve], initial),
            "benchmark_metrics": equity_metrics([row["benchmark"] for row in curve], initial),
            "total_cost": total_cost, "benchmark_cost": benchmark_cost, "orders": len(ledger), "ledger": ledger,
            "curve": [{"date": date(index), **row.to_dict()} for index, row in sampled.iterrows()],
            "assumptions": "Long-only, fractional adjusted-price units, no leverage. Signals at prior close execute at next open; final holdings are liquidated at the last close. Both portfolios pay identical fee/slippage rates. Provider-adjusted OHLC incorporates split/dividend adjustments, not an exact broker dividend-reinvestment model. No taxes, liquidity constraints, or interest on cash. Sharpe uses zero risk-free rate.",
            "disclaimer": "Historical simulation, not an investment recommendation. Today's revised/adjusted history is not a true point-in-time dataset."}
