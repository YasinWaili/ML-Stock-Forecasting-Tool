from __future__ import annotations

from typing import Any


def create_insights(
    overview: dict[str, Any],
    statistics: dict[str, float],
    technical: dict[str, Any],
    risk: dict[str, Any],
    models: dict[str, Any],
) -> list[dict[str, str]]:
    name = overview["name"]
    annual_return = statistics["annualized_return"] * 100
    drawdown = statistics["maximum_drawdown"] * 100
    volatility = statistics["annualized_volatility"] * 100

    summary_direction = "gained" if annual_return >= 0 else "declined"
    summary = (
        f"Across the selected history, {name} {summary_direction} at an annualized "
        f"rate of {abs(annual_return):.1f}%. The rule-based technical reading is "
        f"{technical['signal'].lower()}, while the transparent risk model classifies "
        f"the stock as {risk['classification'].lower()} risk."
    )
    trend = (
        f"Price is trading around ${overview['price']:.2f}. RSI is {technical['rsi']:.1f}, "
        f"and MACD is {'above' if technical['macd'] > technical['macd_signal'] else 'below'} "
        "its signal line. " + " ".join(technical["reasons"][:2])
    )
    risk_text = (
        f"Historical annualized volatility is {volatility:.1f}% and the deepest peak-to-trough "
        f"decline in this sample was {drawdown:.1f}%. Beta versus SPY is "
        f"{statistics['beta']:.2f}. The {risk['score']:.0f}/100 score comes from a published "
        "weighted formula, not an AI opinion."
    )

    if models.get("status") == "complete":
        best = next(
            item for item in models["models"] if item["name"] == models["best_model"]
        )
        model_text = (
            f"{best['name']} had the lowest holdout RMSE (${best['rmse']:.2f}) in this run. "
            f"It estimates the next close near ${best['latest_prediction']:.2f}, with a "
            f"${best['lower_estimate']:.2f}–${best['upper_estimate']:.2f} residual-based range. "
            "That ranking may not persist as market conditions change."
        )
    else:
        model_text = models.get("message", "Model results are not available.")

    return [
        {"title": "Executive summary", "body": summary},
        {"title": "Price & technical trend", "body": trend},
        {"title": "Risk context", "body": risk_text},
        {"title": "Model readout", "body": model_text},
    ]
