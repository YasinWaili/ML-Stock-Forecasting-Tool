import type { ChartPoint, DashboardData, ModelResult } from "./types";

export type Fold = {
  fold: number;
  training_start: string;
  training_target_end: string;
  calibration_start: string;
  calibration_target_end: string;
  test_start: string;
  test_end: string;
  observations: number;
  rmse: number;
  interval_coverage: number;
};
export type ResearchModel = ModelResult & {
  normalized_rmse: number;
  baseline_improvement: number | null;
  interval_coverage: number;
  mean_interval_width: number;
  calibration_period: string;
  folds: Fold[];
  artifact: { file: string; sha256: string } | null;
};
export type Evaluation = Omit<DashboardData["predictions"], "models"> & {
  models: ResearchModel[];
  observations?: number;
  windows?: number;
  execution_ms?: number;
};
export type Dataset = {
  id: string;
  symbol: string;
  period: string;
  created_at: number;
  fetched_at?: string;
  checksum: string;
  quality: {
    observations: number;
    first_date: string;
    last_date: string;
    gaps_over_7_days: number;
    adjusted_prices_available: boolean;
  };
};
export type EvaluationResult = Evaluation & {
  symbol: string;
  dataset: Dataset;
};
export type ReplayResult = {
  symbol: string;
  dataset: Dataset;
  requested_date: string;
  as_of: string;
  price: number;
  technical: DashboardData["technical"];
  predictions: Evaluation;
  available_steps: number;
  observations: number;
  chart: ChartPoint[];
  disclaimer: string;
};
export type EquityMetrics = {
  total_return: number;
  maximum_drawdown: number;
  annualized_volatility: number;
  sharpe_ratio: number;
  final_equity: number;
};
export type Order = {
  signal_date: string;
  execution_date: string;
  side: string;
  units: number;
  price: number;
  fee: number;
  slippage_cost: number;
  cash_after: number;
  reason: string;
  model_version: string | null;
  training_cutoff: string | null;
};
export type BacktestResult = {
  symbol: string;
  dataset: Dataset;
  strategy: string;
  start_date: string;
  end_date: string;
  sessions: number;
  initial_cash: number;
  metrics: EquityMetrics;
  benchmark_metrics: EquityMetrics;
  total_cost: number;
  benchmark_cost: number;
  orders: number;
  ledger: Order[];
  curve: { date: string; equity: number; benchmark: number }[];
  assumptions: string;
  disclaimer: string;
};
export type ResearchResult = EvaluationResult | ReplayResult | BacktestResult;
export type Job = {
  id: string;
  kind: "analysis" | "replay" | "backtest";
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  stage: string;
  attempts: number;
  created_at: number;
  completed_at: number | null;
  error: string | null;
  reused?: boolean;
  params: Record<string, unknown>;
  result: {
    kind: string;
    versions: Record<string, string>;
    results: ResearchResult[];
  } | null;
};
export type Reveal = {
  steps: number;
  prices: { date: string; close: number }[];
  first_session_actual: number | null;
  forecast_checks: {
    name: string;
    forecast: number;
    error: number | null;
    inside_interval: boolean | null;
  }[];
};
