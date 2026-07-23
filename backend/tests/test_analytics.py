import numpy as np
import pandas as pd

from app.services.analytics import (
    add_indicators,
    calculate_statistics,
    risk_assessment,
    technical_snapshot,
)
from app.services.cache import TTLCache
from app.services.downsampling import largest_triangle_three_buckets


def sample_frame(days: int = 300) -> pd.DataFrame:
    index = pd.bdate_range("2024-01-02", periods=days)
    close = pd.Series(np.linspace(100, 155, days), index=index)
    return pd.DataFrame(
        {
            "Open": close - 0.5,
            "High": close + 1.25,
            "Low": close - 1.1,
            "Close": close,
            "Volume": np.linspace(1_000_000, 1_500_000, days),
        },
        index=index,
    )


def test_statistics_are_finite_and_drawdown_is_non_positive():
    stats = calculate_statistics(sample_frame())
    assert stats["annualized_return"] > 0
    assert stats["maximum_drawdown"] <= 0
    assert all(np.isfinite(value) for value in stats.values())


def test_indicators_and_signal_are_structured():
    indicators = add_indicators(sample_frame())
    snapshot = technical_snapshot(indicators)
    assert 0 <= snapshot["rsi"] <= 100
    assert snapshot["signal"] in {
        "Bearish",
        "Slightly bearish",
        "Neutral",
        "Slightly bullish",
        "Bullish",
    }
    assert snapshot["support"] < snapshot["resistance"]


def test_risk_score_uses_bounded_scale():
    indicators = add_indicators(sample_frame())
    stats = calculate_statistics(sample_frame())
    risk = risk_assessment(stats, indicators)
    assert 0 <= risk["score"] <= 100
    assert "volatility" in risk["formula"]


def test_lttb_preserves_bounds_and_requested_size():
    frame = sample_frame(10_000)
    sampled = largest_triangle_three_buckets(frame, 600)
    assert len(sampled) == 600
    assert sampled.index[0] == frame.index[0]
    assert sampled.index[-1] == frame.index[-1]
    assert sampled.index.is_monotonic_increasing


def test_ttl_cache_evicts_least_recently_used_item():
    cache: TTLCache[str, int] = TTLCache(max_size=2, ttl_seconds=60)
    cache.set("first", 1)
    cache.set("second", 2)
    assert cache.get("first") == 1
    cache.set("third", 3)
    assert cache.get("second") is None
    assert cache.get("first") == 1
    assert cache.get("third") == 3
