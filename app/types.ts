export type ChartPoint = {
  date: string;
  close: number;
  volume: number;
  sma20: number | null;
  sma50: number | null;
  upper_band: number | null;
  lower_band: number | null;
};

export type StockSearchResult = {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  logo_url?: string;
};

export type ModelResult = {
  name: string;
  mae: number;
  rmse: number;
  directional_accuracy: number;
  latest_prediction: number;
  predicted_change: number;
  lower_estimate: number;
  upper_estimate: number;
  training_period: string;
  testing_period: string;
  test_observations: number;
  execution_ms: number;
  status: string;
};

export type DashboardData = {
  overview: {
    symbol: string;
    name: string;
    price: number;
    change: number;
    change_percent: number;
    previous_close: number;
    open: number;
    day_high: number;
    day_low: number;
    volume: number;
    average_volume: number;
    market_cap: number;
    week_52_high: number;
    week_52_low: number;
    sector: string;
    industry: string;
    exchange: string;
    currency: string;
    logo_url: string;
    market_state: string;
    as_of: string;
    retrieved_at: string;
    source: string;
  };
  statistics: {
    cumulative_return: number;
    average_daily_return: number;
    annualized_return: number;
    daily_volatility: number;
    annualized_volatility: number;
    standard_deviation: number;
    maximum_drawdown: number;
    sharpe_ratio: number;
    sortino_ratio: number;
    calmar_ratio: number;
    value_at_risk_95: number;
    expected_shortfall_95: number;
    downside_deviation: number;
    benchmark_correlation: number;
    beta: number;
  };
  technical: {
    signal: string;
    signal_score: number;
    rsi: number;
    macd: number;
    macd_signal: number;
    sma_20: number;
    sma_50: number;
    atr: number;
    momentum_10d: number;
    support: number;
    resistance: number;
    golden_cross: boolean;
    death_cross: boolean;
    reasons: string[];
  };
  risk: {
    score: number;
    classification: string;
    volatility_score: number;
    drawdown_score: number;
    beta_score: number;
    value_at_risk_score: number;
    recent_annualized_volatility: number;
    formula: string;
  };
  predictions: {
    status: string;
    best_model?: string;
    models: ModelResult[];
    disclaimer?: string;
    message?: string;
  };
  insights: Array<{ title: string; body: string }>;
  chart: ChartPoint[];
  period: string;
  performance?: {
    source_points: number;
    rendered_points: number;
    sampling: string;
    model_observation_limit: number;
  };
};
