import type { DashboardData } from "./types";

const start = new Date("2025-08-01T00:00:00");
const chart = Array.from({ length: 180 }, (_, index) => {
  const date = new Date(start);
  date.setDate(start.getDate() + index * 1.42);
  const trend = 205 + index * 0.19;
  const wave = Math.sin(index / 8) * 6 + Math.cos(index / 17) * 3;
  const close = trend + wave;
  const sma20 = index < 19 ? null : 205 + (index - 9.5) * 0.19 + Math.sin((index - 9.5) / 8) * 4.7;
  const sma50 = index < 49 ? null : 205 + (index - 24.5) * 0.19 + Math.sin((index - 24.5) / 8) * 2.4;
  return {
    date: date.toISOString().slice(0, 10),
    close: Number(close.toFixed(2)),
    volume: Math.round(42_000_000 + Math.sin(index / 4) * 8_000_000 + (index % 13) * 600_000),
    sma20: sma20 ? Number(sma20.toFixed(2)) : null,
    sma50: sma50 ? Number(sma50.toFixed(2)) : null,
    upper_band: sma20 ? Number((sma20 + 10.5).toFixed(2)) : null,
    lower_band: sma20 ? Number((sma20 - 10.5).toFixed(2)) : null,
  };
});

export const demoData: DashboardData = {
  overview: {
    symbol: "AAPL",
    name: "Apple Inc.",
    price: 239.42,
    change: 3.18,
    change_percent: 0.0135,
    previous_close: 236.24,
    open: 236.91,
    day_high: 240.12,
    day_low: 235.86,
    volume: 51_420_830,
    average_volume: 48_320_000,
    market_cap: 3_580_000_000_000,
    week_52_high: 260.1,
    week_52_low: 169.21,
    sector: "Technology",
    industry: "Consumer Electronics",
    exchange: "NASDAQ",
    currency: "USD",
    logo_url: "",
    market_state: "CLOSED",
    as_of: "2026-07-22",
    retrieved_at: "2026-07-23T00:00:00Z",
    source: "Demo snapshot",
  },
  statistics: {
    cumulative_return: 0.172,
    average_daily_return: 0.0008,
    annualized_return: 0.224,
    daily_volatility: 0.0143,
    annualized_volatility: 0.227,
    standard_deviation: 0.0143,
    maximum_drawdown: -0.118,
    sharpe_ratio: 1.23,
    sortino_ratio: 1.71,
    calmar_ratio: 1.9,
    value_at_risk_95: -0.021,
    expected_shortfall_95: -0.029,
    downside_deviation: 0.161,
    benchmark_correlation: 0.68,
    beta: 1.08,
  },
  technical: {
    signal: "Slightly bullish",
    signal_score: 2,
    rsi: 61.4,
    macd: 2.42,
    macd_signal: 1.87,
    sma_20: 232.74,
    sma_50: 227.31,
    atr: 4.18,
    momentum_10d: 0.032,
    support: 224.6,
    resistance: 244.8,
    golden_cross: false,
    death_cross: false,
    reasons: [
      "Price is above the 20-day average.",
      "Price is above the 50-day average.",
      "RSI is in a neutral range.",
      "MACD is above its signal line.",
    ],
  },
  risk: {
    score: 43,
    classification: "Moderate",
    volatility_score: 37.8,
    drawdown_score: 19.7,
    beta_score: 54,
    value_at_risk_score: 35,
    recent_annualized_volatility: 0.246,
    formula:
      "28% volatility + 26% drawdown + 14% beta + 14% VaR + 12% downside deviation + 6% volatility regime",
  },
  predictions: {
    status: "complete",
    best_model: "Random forest",
    disclaimer:
      "Experimental one-session estimates based only on historical market data.",
    models: [
      {
        name: "Random forest",
        mae: 3.42,
        rmse: 4.61,
        directional_accuracy: 0.574,
        latest_prediction: 241.18,
        predicted_change: 0.0074,
        lower_estimate: 232.14,
        upper_estimate: 250.22,
        training_period: "2025-08-01 to 2026-05-18",
        testing_period: "2026-05-19 to 2026-07-22",
        test_observations: 36,
        execution_ms: 186.4,
        status: "Complete",
      },
      {
        name: "Linear regression",
        mae: 3.78,
        rmse: 5.12,
        directional_accuracy: 0.548,
        latest_prediction: 240.62,
        predicted_change: 0.005,
        lower_estimate: 230.58,
        upper_estimate: 250.66,
        training_period: "2025-08-01 to 2026-05-18",
        testing_period: "2026-05-19 to 2026-07-22",
        test_observations: 36,
        execution_ms: 4.8,
        status: "Complete",
      },
    ],
  },
  insights: [
    {
      title: "Executive summary",
      body: "Across the selected history, Apple gained at an annualized rate of 22.4%. The rule-based technical reading is slightly bullish, while the transparent risk model classifies the stock as moderate risk.",
    },
    {
      title: "Price & technical trend",
      body: "Price is above both the 20-day and 50-day averages. RSI is 61.4—positive without reaching historically overbought territory—and MACD remains above its signal line.",
    },
    {
      title: "Risk context",
      body: "Historical annualized volatility is 22.7% and the deepest peak-to-trough decline in this sample was 11.8%. The 43/100 score comes from the displayed weighted formula, not an AI opinion.",
    },
    {
      title: "Model readout",
      body: "Random forest had the lowest holdout RMSE in this run. It estimates the next close near $241.18, with a $232.14–$250.22 residual-based range. That ranking may not persist.",
    },
  ],
  chart,
  period: "1y",
};
