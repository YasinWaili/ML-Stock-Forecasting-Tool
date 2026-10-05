"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  Download,
  FlaskConical,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PriceChart } from "./PriceChart";
import { researchRequest, useResearchJob } from "./useResearchJob";
import type {
  BacktestResult,
  EvaluationResult,
  Job,
  ReplayResult,
  Reveal,
} from "../research-types";

const fmt = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${fmt(value, 1)}%`;
const tabs = ["Evaluation", "Replay", "Backtest", "Saved runs"] as const;
type Tab = (typeof tabs)[number];

function JobStatus({ state }: { state: ReturnType<typeof useResearchJob> }) {
  if (state.error)
    return (
      <p className="research-error" role="alert">
        {state.error} Your saved runs are unchanged.
      </p>
    );
  if (!state.busy) return null;
  return (
    <div className="research-progress" role="status" aria-live="polite">
      <span>
        <Loader2 size={15} className="spin" />
        {state.job?.stage || "Submitting research run"}
      </span>
      <span>{state.job?.progress || 0}%</span>
      <progress
        value={state.job?.progress || 0}
        max={100}
        aria-label="Research progress"
      />
      <small>
        Runs in the background. You can keep exploring other stocks.
      </small>
    </div>
  );
}

function RunTrace({ job }: { job: Job | null }) {
  if (!job?.result) return null;
  return (
    <details className="research-trace">
      <summary>
        Dataset & reproducibility{" "}
        <span>{job.reused ? "Reused saved result" : "Saved locally"}</span>
      </summary>
      <div className="trace-content">
        <p>
          Run {job.id.slice(0, 8)} · saved{" "}
          {new Date(
            (job.completed_at || job.created_at) * 1000,
          ).toLocaleString()}{" "}
          · engine {job.result.versions.engine}
        </p>
        <p>
          {Object.entries(job.result.versions)
            .filter(([key]) => key !== "engine")
            .map(([key, value]) => `${key} ${value}`)
            .join(" · ")}
        </p>
        {job.result.results.map((result) => (
          <div key={result.symbol}>
            <strong>{result.symbol}</strong> ·{" "}
            {result.dataset.quality.observations.toLocaleString()} sessions ·{" "}
            {result.dataset.quality.first_date} —{" "}
            {result.dataset.quality.last_date}
            <p>
              Provider fetched:{" "}
              {result.dataset.fetched_at || "Existing frozen snapshot"}. Long
              calendar gaps: {result.dataset.quality.gaps_over_7_days}.
            </p>
            <code>SHA-256 {result.dataset.checksum}</code>
          </div>
        ))}
        <a
          className="research-link"
          href={`/api/jobs/${job.id}`}
          download={`research-${job.id.slice(0, 8)}.json`}
        >
          <Download size={14} /> Export full run JSON
        </a>
      </div>
    </details>
  );
}

export function ResearchWorkbench({
  symbol,
  period,
  theme,
  enabled,
  onEvaluation,
}: {
  symbol: string;
  period: string;
  theme: "light" | "dark";
  enabled: boolean;
  onEvaluation: (symbol: string, result: EvaluationResult) => void;
}) {
  const [tab, setTab] = useState<Tab>("Evaluation");
  const [comparison, setComparison] = useState("");
  const [evaluationPeriod, setEvaluationPeriod] = useState("1y");
  const [replayDate, setReplayDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [strategy, setStrategy] = useState("sma");
  const [cash, setCash] = useState("10000");
  const [fee, setFee] = useState("5");
  const [slippage, setSlippage] = useState("5");
  const [saved, setSaved] = useState<Job[]>([]);
  const [savedError, setSavedError] = useState("");
  const [revealed, setRevealed] = useState<Reveal | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState("");
  const revealRequest = useRef<AbortController | null>(null);
  useEffect(() => () => revealRequest.current?.abort(), []);
  const analysis = useResearchJob();
  const replay = useResearchJob();
  const backtest = useResearchJob();
  const { run: runAnalysis, cancel: cancelAnalysis } = analysis;
  const acceptEvaluation = useCallback(
    (job: Job | null) => {
      const result = job?.result?.results.find(
        (item) => item.symbol === symbol,
      ) as EvaluationResult | undefined;
      if (result) onEvaluation(symbol, result);
    },
    [onEvaluation, symbol],
  );
  useEffect(() => {
    if (!enabled) return;
    void runAnalysis({
      kind: "analysis",
      symbols: [symbol],
      period: ["1y", "5y", "max"].includes(period) ? period : "1y",
    }).then(acceptEvaluation);
    return cancelAnalysis;
  }, [enabled, symbol, period, runAnalysis, cancelAnalysis, acceptEvaluation]);

  const refreshSaved = useCallback(async () => {
    try {
      const payload = await researchRequest<{ jobs: Job[] }>("/api/jobs");
      setSaved(payload.jobs);
      setSavedError("");
    } catch (caught) {
      setSavedError(
        caught instanceof Error ? caught.message : "Saved runs unavailable.",
      );
    }
  }, []);

  async function evaluate(event: FormEvent) {
    event.preventDefault();
    const symbols = [
      ...new Set([
        symbol,
        ...comparison
          .split(/[\s,]+/)
          .filter(Boolean)
          .map((value) => value.toUpperCase()),
      ]),
    ];
    acceptEvaluation(
      await analysis.run({
        kind: "analysis",
        symbols,
        period: evaluationPeriod,
        force: true,
      }),
    );
  }
  async function reconstruct(event: FormEvent) {
    event.preventDefault();
    revealRequest.current?.abort();
    setRevealing(false);
    setRevealed(null);
    setRevealError("");
    await replay.run({
      kind: "replay",
      symbols: [symbol],
      period: "5y",
      as_of: replayDate,
    });
  }
  async function simulate(event: FormEvent) {
    event.preventDefault();
    await backtest.run({
      kind: "backtest",
      symbols: [symbol],
      period: "5y",
      strategy,
      initial_cash: Number(cash),
      fee_bps: Number(fee),
      slippage_bps: Number(slippage),
      ...(startDate ? { start_date: startDate } : {}),
      ...(endDate ? { end_date: endDate } : {}),
    });
  }
  async function revealNext(steps: number) {
    if (!replay.job) return;
    revealRequest.current?.abort();
    const controller = new AbortController();
    revealRequest.current = controller;
    setRevealing(true);
    setRevealError("");
    try {
      const outcome = await researchRequest<Reveal>(
        `/api/replays/${replay.job.id}/reveal?steps=${steps}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setRevealed(outcome);
    } catch (caught) {
      if (!controller.signal.aborted)
        setRevealError(
          caught instanceof Error
            ? caught.message
            : "Could not reveal outcomes.",
        );
    } finally {
      if (!controller.signal.aborted) setRevealing(false);
    }
  }
  async function openSaved(job: Job) {
    if (job.kind === "analysis") {
      setTab("Evaluation");
      acceptEvaluation(await analysis.open(job.id));
    }
    if (job.kind === "replay") {
      revealRequest.current?.abort();
      setRevealing(false);
      setTab("Replay");
      setRevealed(null);
      setRevealError("");
      await replay.open(job.id);
    }
    if (job.kind === "backtest") {
      setTab("Backtest");
      await backtest.open(job.id);
    }
  }

  function chooseTab(name: Tab) {
    setTab(name);
    if (name === "Saved runs") void refreshSaved();
  }

  const evaluations = analysis.job?.result?.results as
    EvaluationResult[] | undefined;
  const reconstructed = replay.job?.result?.results[0] as
    ReplayResult | undefined;
  const simulation = backtest.job?.result?.results[0] as
    BacktestResult | undefined;
  const state =
    tab === "Evaluation" ? analysis : tab === "Replay" ? replay : backtest;
  return (
    <>
      <div className="section-heading" id="research">
        <div>
          <h2>
            <FlaskConical size={18} /> Research lab
          </h2>
          <p>
            Test the models. Rewind the market. Compare a strategy with holding
            the stock.
          </p>
        </div>
        <span className="experimental-label">Local experiments</span>
      </div>
      <section className="panel research-panel" aria-label="Research lab">
        <div
          className="research-tabs"
          role="tablist"
          aria-label="Research tools"
        >
          {tabs.map((name) => (
            <button
              key={name}
              role="tab"
              tabIndex={tab === name ? 0 : -1}
              aria-selected={tab === name}
              aria-controls={`research-${name.replace(" ", "-")}`}
              id={`tab-${name.replace(" ", "-")}`}
              onClick={() => chooseTab(name)}
              onKeyDown={(event) => {
                const index = tabs.indexOf(name);
                const nextIndex =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : -1;
                if (nextIndex < 0) return;
                event.preventDefault();
                const next = tabs[nextIndex];
                chooseTab(next);
                document
                  .getElementById(`tab-${next.replace(" ", "-")}`)
                  ?.focus();
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <div
          className="research-body"
          role="tabpanel"
          id={`research-${tab.replace(" ", "-")}`}
          aria-labelledby={`tab-${tab.replace(" ", "-")}`}
        >
          {!enabled && (
            <p className="research-note">
              Research needs live provider data. Load a stock to start;
              synthetic sample data is not used for these experiments.
            </p>
          )}
          {tab === "Evaluation" && (
            <>
              <div className="research-intro">
                <h3>Does the model beat a simple baseline?</h3>
                <p>
                  Three expanding test windows, one-session forecasts, and a
                  separate calibration slice. The last-close baseline is allowed
                  to win.
                </p>
              </div>
              <form className="research-form" onSubmit={evaluate}>
                <label>
                  Compare with (up to 2 tickers)
                  <input
                    value={comparison}
                    onChange={(event) => setComparison(event.target.value)}
                    placeholder="MSFT, CIEN"
                    aria-label="Comparison tickers"
                  />
                </label>
                <label>
                  History
                  <select
                    value={evaluationPeriod}
                    onChange={(event) =>
                      setEvaluationPeriod(event.target.value)
                    }
                  >
                    <option value="1y">1 year</option>
                    <option value="5y">5 years</option>
                    <option value="max">All available</option>
                  </select>
                </label>
                <button
                  className="research-button"
                  disabled={!enabled || analysis.busy}
                  type="submit"
                >
                  Run fresh evaluation <ArrowRight size={15} />
                </button>
              </form>
              <JobStatus state={analysis} />
              {evaluations?.map((evaluation) => (
                <div className="evaluation-result" key={evaluation.symbol}>
                  <div className="research-result-heading">
                    <h3>{evaluation.symbol}</h3>
                    <span>
                      {evaluation.observations?.toLocaleString() || 0} modelling
                      observations · 3 windows
                    </span>
                  </div>
                  {evaluation.message && (
                    <p className="research-note">{evaluation.message}</p>
                  )}
                  {!!evaluation.models.length && (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Model</th>
                            <th>RMSE / mean price</th>
                            <th>vs. baseline</th>
                            <th>Direction accuracy</th>
                            <th>Interval coverage</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evaluation.models.map((model) => (
                            <tr key={model.name}>
                              <td>
                                <strong>{model.name}</strong>
                                {model.name === evaluation.best_model && (
                                  <small className="best-model">
                                    Lowest unseen error
                                  </small>
                                )}
                              </td>
                              <td>{fmt(model.normalized_rmse)}%</td>
                              <td
                                className={
                                  (model.baseline_improvement || 0) >= 0
                                    ? "positive"
                                    : "negative"
                                }
                              >
                                {percent(model.baseline_improvement)}
                              </td>
                              <td>
                                {fmt(model.directional_accuracy * 100, 1)}%
                              </td>
                              <td>
                                {fmt(model.interval_coverage, 1)}%
                                <small>
                                  95% target · width{" "}
                                  {fmt(model.mean_interval_width)}
                                </small>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {evaluation.models[0] && (
                    <details className="research-folds">
                      <summary>Inspect the chronological test windows</summary>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Window</th>
                              <th>Training labels end</th>
                              <th>Calibration labels end</th>
                              <th>Unseen test period</th>
                            </tr>
                          </thead>
                          <tbody>
                            {evaluation.models[0].folds.map((fold) => (
                              <tr key={fold.fold}>
                                <td>{fold.fold}</td>
                                <td>{fold.training_target_end}</td>
                                <td>{fold.calibration_target_end}</td>
                                <td>
                                  {fold.test_start} — {fold.test_end}
                                  <small>
                                    {fold.observations} sessions · one-row
                                    boundary gap
                                  </small>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </div>
              ))}
              <p className="research-note">
                Positive “vs. baseline” means lower RMSE. Price-normalized error
                helps compare stocks. Direction accuracy counts exact
                up/down/flat agreement; a flat baseline usually scores poorly.
                Interval coverage is measured on unseen test observations, not
                guaranteed in the future. Prices and interval widths are in each
                stock’s quote units.
              </p>
            </>
          )}
          {tab === "Replay" && (
            <>
              <div className="research-intro">
                <h3>What would you have seen on that day?</h3>
                <p>
                  Choose a cutoff, inspect the historical chart and forecasts,
                  then reveal what happened next.
                </p>
              </div>
              <form className="research-form" onSubmit={reconstruct}>
                <label>
                  Historical cutoff
                  <input
                    required
                    type="date"
                    value={replayDate}
                    onChange={(event) => setReplayDate(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className="research-button"
                  disabled={!enabled || replay.busy}
                >
                  Reconstruct {symbol} <ArrowRight size={15} />
                </button>
              </form>
              <JobStatus state={replay} />
              {reconstructed && (
                <>
                  <div className="replay-summary">
                    <div>
                      <span className="label">
                        {reconstructed.symbol} · through {reconstructed.as_of}
                      </span>
                      <strong>{fmt(reconstructed.price)}</strong>
                    </div>
                    <div>
                      <span className="label">Historical reading</span>
                      <strong>{reconstructed.technical.signal}</strong>
                    </div>
                    <div>
                      <span className="label">Observed sessions</span>
                      <strong>
                        {reconstructed.observations.toLocaleString()}
                      </strong>
                    </div>
                  </div>
                  <div className="replay-chart">
                    <PriceChart
                      points={reconstructed.chart}
                      currency=""
                      theme={theme}
                      showSma
                      showBands={false}
                      showVolume={false}
                    />
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Frozen forecast</th>
                          <th>Next close estimate</th>
                          <th>Calibrated range</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reconstructed.predictions.models.map((model) => (
                          <tr key={model.name}>
                            <td>{model.name}</td>
                            <td>{fmt(model.latest_prediction)}</td>
                            <td>
                              {fmt(model.lower_estimate)} —{" "}
                              {fmt(model.upper_estimate)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="reveal-controls">
                    <span>
                      {reconstructed.available_steps} future sessions available
                    </span>
                    <button
                      className="research-button secondary"
                      disabled={revealing || !reconstructed.available_steps}
                      onClick={() =>
                        revealNext(
                          Math.min(
                            reconstructed.available_steps,
                            (revealed?.steps || 0) + 1,
                          ),
                        )
                      }
                    >
                      Reveal next session <ArrowRight size={14} />
                    </button>
                    <button
                      className="research-button secondary"
                      disabled={revealing || !reconstructed.available_steps}
                      onClick={() =>
                        revealNext(Math.min(20, reconstructed.available_steps))
                      }
                    >
                      Reveal 20 sessions
                    </button>
                  </div>
                  {revealError && (
                    <p className="research-error" role="alert">
                      {revealError}
                    </p>
                  )}
                  {revealed && (
                    <div className="reveal-results">
                      <h3>
                        Outcome · first next-session close{" "}
                        {fmt(revealed.first_session_actual)}
                      </h3>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Model</th>
                              <th>Actual − forecast</th>
                              <th>Inside frozen interval?</th>
                            </tr>
                          </thead>
                          <tbody>
                            {revealed.forecast_checks.map((check) => (
                              <tr key={check.name}>
                                <td>{check.name}</td>
                                <td>{fmt(check.error)}</td>
                                <td>
                                  {check.inside_interval == null
                                    ? "—"
                                    : check.inside_interval
                                      ? "Yes"
                                      : "No"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="revealed-prices">
                        {revealed.prices.map((price) => (
                          <span key={price.date}>
                            {price.date}
                            <strong>{fmt(price.close)}</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="research-note">{reconstructed.disclaimer}</p>
                </>
              )}
              {!reconstructed && (
                <p className="research-note">
                  Uses the last five years of daily history. Leave at least 180
                  sessions before the cutoff for training. Current company facts
                  are not fed into the historical forecast.
                </p>
              )}
            </>
          )}
          {tab === "Backtest" && (
            <>
              <div className="research-intro">
                <h3>A strategy, with the costs left in.</h3>
                <p>
                  Signals at the previous close. Execution at the next open. A
                  buy-and-hold comparison using the same costs.
                </p>
              </div>
              <form className="research-form backtest-form" onSubmit={simulate}>
                <label>
                  Strategy
                  <select
                    value={strategy}
                    onChange={(event) => setStrategy(event.target.value)}
                  >
                    <option value="sma">20/50-day moving average</option>
                    <option value="ml">
                      Linear forecast · retrain every 20 sessions
                    </option>
                  </select>
                </label>
                <label>
                  Start (optional)
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </label>
                <label>
                  End (optional)
                  <input
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </label>
                <label>
                  Starting capital
                  <input
                    required
                    type="number"
                    min="100"
                    max="1000000000"
                    value={cash}
                    onChange={(event) => setCash(event.target.value)}
                  />
                </label>
                <label>
                  Fee per order (bps)
                  <input
                    required
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={fee}
                    onChange={(event) => setFee(event.target.value)}
                  />
                </label>
                <label>
                  Slippage (bps)
                  <input
                    required
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={slippage}
                    onChange={(event) => setSlippage(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className="research-button"
                  disabled={!enabled || backtest.busy}
                >
                  Run simulation <ArrowRight size={15} />
                </button>
              </form>
              <p className="research-note">
                1 basis point = 0.01%. Blank dates use the latest ~252 sessions.
                Capital is in the stock’s quote currency. Simulations are
                limited to 1,250 sessions.
              </p>
              <JobStatus state={backtest} />
              {simulation && (
                <>
                  <div className="research-result-heading">
                    <h3>
                      {simulation.symbol} ·{" "}
                      {simulation.strategy === "sma"
                        ? "Moving-average strategy"
                        : "Linear forecast strategy"}
                    </h3>
                    <span>
                      {simulation.start_date} — {simulation.end_date} ·{" "}
                      {simulation.sessions} sessions
                    </span>
                  </div>
                  <div className="backtest-metrics">
                    <div>
                      <span className="label">Strategy net return</span>
                      <strong
                        className={
                          simulation.metrics.total_return >= 0
                            ? "positive"
                            : "negative"
                        }
                      >
                        {percent(simulation.metrics.total_return)}
                      </strong>
                      <small>
                        Buy & hold{" "}
                        {percent(simulation.benchmark_metrics.total_return)}
                      </small>
                    </div>
                    <div>
                      <span className="label">Maximum drawdown</span>
                      <strong>
                        {percent(simulation.metrics.maximum_drawdown)}
                      </strong>
                      <small>
                        Buy & hold{" "}
                        {percent(simulation.benchmark_metrics.maximum_drawdown)}
                      </small>
                    </div>
                    <div>
                      <span className="label">Sharpe ratio</span>
                      <strong>{fmt(simulation.metrics.sharpe_ratio)}</strong>
                      <small>
                        Buy & hold{" "}
                        {fmt(simulation.benchmark_metrics.sharpe_ratio)}
                      </small>
                    </div>
                    <div>
                      <span className="label">Trading costs</span>
                      <strong>{fmt(simulation.total_cost)}</strong>
                      <small>{simulation.orders} orders · quote units</small>
                    </div>
                  </div>
                  <div className="equity-legend">
                    <span>Strategy</span>
                    <span>Buy & hold</span>
                  </div>
                  <div
                    className="equity-chart"
                    role="img"
                    aria-label="Net portfolio equity compared with buy and hold"
                  >
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart
                        data={simulation.curve}
                        margin={{ left: 5, right: 15, top: 10, bottom: 5 }}
                      >
                        <CartesianGrid
                          stroke="var(--border)"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: "var(--muted)", fontSize: 11 }}
                          minTickGap={80}
                          tickFormatter={(value: string) => value.slice(0, 7)}
                        />
                        <YAxis
                          tick={{ fill: "var(--muted)", fontSize: 11 }}
                          width={65}
                          domain={["auto", "auto"]}
                          tickFormatter={(value: number) =>
                            new Intl.NumberFormat("en", {
                              notation: "compact",
                            }).format(value)
                          }
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            color: "var(--text)",
                          }}
                          formatter={(value) => fmt(Number(value))}
                        />
                        <Line
                          name="Strategy"
                          dataKey="equity"
                          stroke="var(--accent)"
                          type="linear"
                          dot={false}
                          isAnimationActive={false}
                          strokeWidth={2}
                        />
                        <Line
                          name="Buy & hold"
                          dataKey="benchmark"
                          stroke="var(--green)"
                          type="linear"
                          dot={false}
                          isAnimationActive={false}
                          strokeWidth={1.5}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <details className="research-folds">
                    <summary>Trade ledger · {simulation.orders} orders</summary>
                    <a
                      className="research-link"
                      href={`/api/jobs/${backtest.job!.id}/ledger`}
                      download
                    >
                      <Download size={14} /> Export full CSV
                    </a>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Signal</th>
                            <th>Execution</th>
                            <th>Side</th>
                            <th>Adjusted units</th>
                            <th>Price</th>
                            <th>Fee + slippage</th>
                            <th>Model / cutoff</th>
                          </tr>
                        </thead>
                        <tbody>
                          {simulation.ledger.slice(-100).map((order, index) => (
                            <tr key={index}>
                              <td>{order.signal_date}</td>
                              <td>
                                {order.execution_date}
                                <small>{order.reason}</small>
                              </td>
                              <td>{order.side}</td>
                              <td>{fmt(order.units, 4)}</td>
                              <td>{fmt(order.price)}</td>
                              <td>{fmt(order.fee + order.slippage_cost)}</td>
                              <td>
                                {order.model_version || "Rule-based"}
                                <small>
                                  {order.training_cutoff ||
                                    "Prior-session averages"}
                                </small>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="research-note">
                      Showing the last 100 orders. The export includes the full
                      ledger.
                    </p>
                  </details>
                  <p className="research-note">{simulation.assumptions}</p>
                  <p className="research-note">{simulation.disclaimer}</p>
                </>
              )}
            </>
          )}
          {tab === "Saved runs" && (
            <>
              <div className="research-intro saved-heading">
                <div>
                  <h3>Experiments that survive a restart</h3>
                  <p>
                    The latest 20 runs, with frozen datasets, parameters, and
                    engine versions.
                  </p>
                </div>
                <button
                  className="research-button secondary"
                  onClick={refreshSaved}
                >
                  <RefreshCw size={14} /> Refresh
                </button>
              </div>
              {savedError && (
                <p className="research-error" role="alert">
                  {savedError}
                </p>
              )}
              {saved.length ? (
                <div className="saved-runs">
                  {saved.map((job) => (
                    <button key={job.id} onClick={() => openSaved(job)}>
                      <div>
                        <strong>
                          {(job.params.symbols as string[]).join(", ")}
                        </strong>
                        <span>
                          {job.kind === "analysis"
                            ? "Evaluation"
                            : job.kind === "replay"
                              ? "Historical replay"
                              : "Backtest"}{" "}
                          · {new Date(job.created_at * 1000).toLocaleString()}
                        </span>
                      </div>
                      <span className={`job-badge ${job.status}`}>
                        {job.status}
                        {job.status === "running" ? ` · ${job.progress}%` : ""}
                      </span>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="research-note">
                  No saved research yet. Run an evaluation, replay, or backtest
                  to get started.
                </p>
              )}
              <p className="research-note">
                Identical runs reuse results within a 15-minute freshness
                window. Fresh evaluations fetch data again. Provider failures
                retry up to three attempts; interrupted jobs resume when the
                local API restarts. This queue is designed for a single local
                API process.
              </p>
            </>
          )}
          {tab !== "Saved runs" && <RunTrace job={state.job} />}
        </div>
      </section>
    </>
  );
}
