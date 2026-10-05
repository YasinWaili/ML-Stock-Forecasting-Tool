"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  Moon,
  RefreshCw,
  Search,
  Sun,
  TrendingUp,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { demoData } from "./demo-data";
import { PriceChart } from "./components/PriceChart";
import { CompanyLogo } from "./components/CompanyLogo";
import { ResearchWorkbench } from "./components/ResearchWorkbench";
import type { EvaluationResult } from "./research-types";
import type { DashboardData, StockSearchResult } from "./types";

const periods = [
  ["1m", "1M"],
  ["3mo", "3M"],
  ["6mo", "6M"],
  ["1y", "1Y"],
  ["5y", "5Y"],
  ["max", "All"],
];
const pct = (value: number | null | undefined, signed = false) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : `${signed && value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const number = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const startingStock: StockSearchResult = {
  symbol: "AAPL",
  name: "Apple Inc.",
  exchange: "NASDAQ",
  type: "EQUITY",
  logo_url: "/api/stocks/AAPL/logo",
};
type Origin = { left: number; top: number; width: number };

function Panel({
  children,
  loading,
  className = "",
  label,
}: {
  children: ReactNode;
  loading: boolean;
  className?: string;
  label: string;
}) {
  return (
    <section
      className={`panel ${className} ${loading ? "is-loading" : ""}`}
      aria-label={label}
      aria-busy={loading}
    >
      <div className="panel-content">{children}</div>
      {loading && (
        <div className="panel-loader" role="status">
          <div className="loader-label">
            <Loader2 size={15} /> Loading {label.toLowerCase()}
          </div>
          <div className="skeleton-lines">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}
    </section>
  );
}

const Metric = memo(function Metric({
  label,
  value,
  detail,
  tone = "",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="metric">
      <span className="label">{label}</span>
      <strong className={tone}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
});

export default function StockDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [selection, setSelection] = useState(startingStock);
  const [period, setPeriod] = useState("1y");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sample, setSample] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [showSma, setShowSma] = useState(false);
  const [showBands, setShowBands] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [note, setNote] = useState(0);
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const logoTarget = useRef<HTMLDivElement>(null);
  const origin = useRef<Origin | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const acceptEvaluation = useCallback(
    (symbol: string, predictions: EvaluationResult) => {
      setData((previous) => {
        if (
          !previous ||
          previous.overview.symbol !== symbol ||
          predictions.dataset.quality.last_date !== previous.overview.as_of
        )
          return previous;
        const best = predictions.models.find(
          (model) => model.name === predictions.best_model,
        );
        const modelText = best
          ? `${best.name} had the lowest error across three chronological test windows. Its next-session estimate is ${best.latest_prediction.toFixed(2)}. This ranking can change; the last-close baseline is included for comparison.`
          : predictions.message || "Model evaluation is unavailable.";
        return {
          ...previous,
          predictions,
          insights: previous.insights.map((insight) =>
            insight.title === "Model readout"
              ? { ...insight, body: modelText }
              : insight,
          ),
        };
      });
    },
    [],
  );

  const loadStock = useCallback(
    async (stock: StockSearchResult, range: string, from?: Origin) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      const id = ++sequence.current;
      origin.current = from || null;
      setSelection(stock);
      setPeriod(range);
      setLoading(true);
      setError("");
      setNote(0);
      try {
        const response = await fetch(
          `/api/stocks/${encodeURIComponent(stock.symbol)}/dashboard?period=${range}&max_points=650`,
          { signal: controller.signal },
        );
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.detail || "Stock data could not be loaded.");
        if (id !== sequence.current) return;
        setData(payload);
        setSelection({ ...stock, ...payload.overview });
        setSample(false);
        setRevision((value) => value + 1);
        setRecent((previous) => {
          const next = [
            stock.symbol,
            ...previous.filter((item) => item !== stock.symbol),
          ].slice(0, 4);
          try {
            localStorage.setItem("stock-analysis-recent", JSON.stringify(next));
          } catch {
            /* Storage may be disabled. */
          }
          return next;
        });
      } catch (caught) {
        if (controller.signal.aborted || id !== sequence.current) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Stock data could not be loaded.",
        );
      } finally {
        if (id === sequence.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem("stock-analysis-theme");
      const initial =
        saved === "light" || saved === "dark"
          ? saved
          : matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark";
      // Hydrate the client-only preference after SSR; it cannot be read on the server.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTheme(initial);
      document.documentElement.dataset.theme = initial;
      const history = JSON.parse(
        localStorage.getItem("stock-analysis-recent") ||
          localStorage.getItem("northstar-recent") ||
          "[]",
      );
      if (Array.isArray(history))
        setRecent(
          history
            .filter(
              (item) =>
                typeof item === "string" && /^[A-Z0-9.^=\-]{1,20}$/.test(item),
            )
            .slice(0, 4),
        );
    } catch {
      /* Defaults remain usable with storage blocked. */
    }
    void loadStock(startingStock, "1y");
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => {
      request.current?.abort();
      window.removeEventListener("keydown", shortcut);
    };
  }, [loadStock]);

  useLayoutEffect(() => {
    const target = logoTarget.current;
    const source = origin.current;
    origin.current = null;
    if (!target || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const destination = target.getBoundingClientRect();
    const animation = target.animate(
      source
        ? [
            {
              transform: `translate(${source.left - destination.left}px, ${source.top - destination.top}px) scale(${source.width / destination.width})`,
              opacity: 0.75,
            },
            { transform: "translate(0, 0) scale(1)", opacity: 1 },
          ]
        : [
            { transform: "translateY(8px)", opacity: 0 },
            { transform: "translateY(0)", opacity: 1 },
          ],
      { duration: source ? 420 : 240, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
    return () => animation.cancel();
  }, [selection.symbol]);

  useEffect(() => {
    const cleaned = query.trim();
    if (cleaned.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/stocks/search?q=${encodeURIComponent(cleaned)}`,
          { signal: controller.signal },
        );
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            payload.detail || "Search is unavailable. Try a ticker symbol.",
          );
        if (!controller.signal.aborted) setResults(payload.results || []);
      } catch (caught) {
        if (!controller.signal.aborted)
          setSearchError(
            caught instanceof Error ? caught.message : "Search is unavailable.",
          );
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const choose = (stock: StockSearchResult, source?: HTMLElement | null) => {
    const rect = source
      ?.querySelector(".company-logo")
      ?.getBoundingClientRect();
    setQuery("");
    setFocused(false);
    setResults([]);
    setSearching(false);
    void loadStock(
      stock,
      period,
      rect ? { left: rect.left, top: rect.top, width: rect.width } : undefined,
    );
    input.current?.blur();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (results.length && !searching) {
      choose(
        results[activeResult],
        document.getElementById(`stock-result-${activeResult}`),
      );
      return;
    }
    const ticker = query.trim().toUpperCase();
    if (/^[A-Z0-9^][A-Z0-9.^=\-]{0,19}$/.test(ticker) && !searching)
      choose({ symbol: ticker, name: ticker, exchange: "", type: "EQUITY" });
  };
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("stock-analysis-theme", next);
    } catch {
      /* Optional persistence. */
    }
  };
  const showSample = () => {
    request.current?.abort();
    sequence.current++;
    setData(demoData);
    setSelection(startingStock);
    setSample(true);
    setLoading(false);
    setPeriod("1y");
    setError("");
    setRevision((value) => value + 1);
  };
  const visible = data?.overview.symbol === selection.symbol ? data : null;
  const overview = visible?.overview;
  const stats = visible?.statistics;
  const technical = visible?.technical;
  const risk = visible?.risk;
  const currency = overview?.currency || "USD";
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }),
    [currency],
  );
  const money = (value: number | null | undefined) =>
    value == null || !Number.isFinite(value) ? "—" : formatter.format(value);
  const selectedPeriod =
    periods.find(([key]) => key === (visible?.period || period))?.[1] || "1Y";

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="#overview">
            <span className="brand-logo">
              <TrendingUp size={21} strokeWidth={2} />
            </span>
            Stock Analysis
            <span className="prototype-label">Local workspace</span>
          </a>
          <nav aria-label="Dashboard sections">
            <a href="#overview">Overview</a>
            <a href="#technicals">Technicals</a>
            <a href="#models">Models</a>
            <a href="#research">Research</a>
          </nav>
          <button
            className="icon-button theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </div>
      </header>
      <main className="workspace" id="overview">
        <div className="search-row">
          <div className="search-wrap">
            <form
              className={`search-field ${focused ? "focused" : ""}`}
              onSubmit={submit}
              role="search"
            >
              <Search size={19} />
              <input
                ref={input}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setFocused(true);
                  setResults([]);
                  setActiveResult(0);
                  setSearchError("");
                  setSearching(event.target.value.trim().length >= 2);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder="Search a company or ticker"
                aria-label="Search a company or ticker"
                role="combobox"
                aria-expanded={focused && query.trim().length >= 2}
                aria-controls="stock-results"
                aria-autocomplete="list"
                aria-activedescendant={
                  results.length ? `stock-result-${activeResult}` : undefined
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setFocused(false);
                    input.current?.blur();
                  }
                  if (
                    results.length &&
                    ["ArrowDown", "ArrowUp"].includes(event.key)
                  ) {
                    event.preventDefault();
                    setActiveResult(
                      (value) =>
                        (value +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          results.length) %
                        results.length,
                    );
                  }
                }}
              />
              {query ? (
                <button
                  type="button"
                  className="clear-search"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery("");
                    setResults([]);
                    setSearching(false);
                    input.current?.focus();
                  }}
                >
                  <X size={16} />
                </button>
              ) : (
                <kbd>Ctrl K</kbd>
              )}
            </form>
            {focused && query.trim().length >= 2 && (
              <div
                className="search-popover"
                id="stock-results"
                role="listbox"
                aria-label="Matching stocks"
              >
                {searching ? (
                  <div className="search-message">
                    <Loader2 size={16} className="spin" /> Finding companies…
                  </div>
                ) : searchError ? (
                  <p className="search-message">{searchError}</p>
                ) : !results.length ? (
                  <p className="search-message">
                    No companies found. Try another name or enter a ticker.
                  </p>
                ) : (
                  results.map((stock, index) => (
                    <button
                      type="button"
                      id={`stock-result-${index}`}
                      key={stock.symbol}
                      className={`search-result ${index === activeResult ? "active" : ""}`}
                      role="option"
                      aria-selected={index === activeResult}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveResult(index)}
                      onClick={(event) => choose(stock, event.currentTarget)}
                    >
                      <CompanyLogo
                        symbol={stock.symbol}
                        url={stock.logo_url}
                        small
                      />
                      <span className="result-name">
                        <strong>{stock.name}</strong>
                        <small>
                          {stock.exchange} ·{" "}
                          {stock.type === "ETF" ? "ETF" : "Stock"}
                        </small>
                      </span>
                      <span className="ticker">{stock.symbol}</span>
                      <ArrowRight size={15} />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {recent.length > 0 && (
            <div className="recent-searches">
              <span>Recent</span>
              {recent.map((symbol) => (
                <button
                  key={symbol}
                  onClick={() =>
                    choose({
                      symbol,
                      name: symbol,
                      exchange: "",
                      type: "EQUITY",
                    })
                  }
                >
                  {symbol}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="error-notice" role="alert">
            <div>
              <strong>Couldn’t load {selection.symbol}</strong>
              <p>
                {error}
                {visible && !sample
                  ? " The last successful snapshot is still shown below."
                  : ""}
              </p>
            </div>
            <button
              className="text-button"
              onClick={() => void loadStock(selection, period)}
            >
              <RefreshCw size={15} /> Retry
            </button>
            {!visible && (
              <button className="text-button" onClick={showSample}>
                View sample
              </button>
            )}
          </div>
        )}
        <section className="stock-heading" aria-label="Selected company">
          <div className="company-identity">
            <div ref={logoTarget} className="logo-dock">
              <CompanyLogo
                key={selection.symbol}
                symbol={selection.symbol}
                url={selection.logo_url}
              />
            </div>
            <div className="company-title" key={selection.symbol}>
              <div className="identity-line">
                <h1>{overview?.name || selection.name}</h1>
                <span className="ticker">{selection.symbol}</span>
                {sample && <span className="sample-badge">Sample data</span>}
              </div>
              <p>
                {overview
                  ? `${overview.exchange} · ${overview.sector} · ${currency}`
                  : loading
                    ? "Fetching company information…"
                    : "Company research"}
              </p>
            </div>
          </div>
          <div
            className={`quote ${loading ? "quote-loading" : ""}`}
            aria-busy={loading}
          >
            <div className="quote-value">
              {money(overview?.price)}
              <span
                className={`price-change ${(overview?.change || 0) >= 0 ? "positive" : "negative"}`}
              >
                {overview &&
                  (overview.change >= 0 ? (
                    <ArrowUpRight size={17} />
                  ) : (
                    <ArrowDownRight size={17} />
                  ))}
                {overview &&
                  `${money(overview.change)} (${pct(overview.change_percent, true)})`}
              </span>
            </div>
            <p>
              {overview
                ? `Latest daily price · ${overview.as_of} · ${overview.source}`
                : "Daily price and historical analysis"}
            </p>
          </div>
        </section>
        <div
          className={`metric-strip ${loading ? "metrics-loading" : ""}`}
          aria-busy={loading}
        >
          <Metric
            label="Return in range"
            value={pct(stats?.cumulative_return, true)}
            detail={`${selectedPeriod} selected history`}
            tone={
              (stats?.cumulative_return || 0) >= 0 ? "positive" : "negative"
            }
          />
          <Metric
            label="Annualized volatility"
            value={pct(stats?.annualized_volatility)}
            detail="Historical price variation"
          />
          <Metric
            label="Max. drawdown"
            value={pct(stats?.maximum_drawdown)}
            detail="Largest peak-to-trough decline"
          />
          <Metric
            label="Technical reading"
            value={technical?.signal || "—"}
            detail={
              technical
                ? `RSI ${number(technical.rsi, 1)}`
                : "Based on price indicators"
            }
          />
        </div>
        <div className="overview-grid">
          <Panel
            loading={loading}
            label="Price history"
            className="chart-panel"
          >
            <div className="panel-heading">
              <div>
                <h2>Price history</h2>
                <p>Daily prices · {currency}</p>
              </div>
              <div className="range-control" aria-label="Chart time range">
                {periods.map(([key, label]) => (
                  <button
                    key={key}
                    className={period === key ? "selected" : ""}
                    aria-pressed={period === key}
                    onClick={() => {
                      if (key !== period) void loadStock(selection, key);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="chart-tools">
              <button
                aria-pressed={showSma}
                onClick={() => setShowSma(!showSma)}
              >
                <span className={`check-box ${showSma ? "checked" : ""}`}>
                  {showSma && <Check size={11} />}
                </span>
                Moving averages
              </button>
              <button
                aria-pressed={showBands}
                onClick={() => setShowBands(!showBands)}
              >
                <span className={`check-box ${showBands ? "checked" : ""}`}>
                  {showBands && <Check size={11} />}
                </span>
                Bollinger bands
              </button>
              <button
                aria-pressed={showVolume}
                onClick={() => setShowVolume(!showVolume)}
              >
                <span className={`check-box ${showVolume ? "checked" : ""}`}>
                  {showVolume && <Check size={11} />}
                </span>
                Volume
              </button>
            </div>
            <div
              className="chart-reveal"
              key={`${revision}-${selection.symbol}`}
            >
              {visible ? (
                <PriceChart
                  points={visible.chart}
                  currency={currency}
                  showSma={showSma}
                  showBands={showBands}
                  showVolume={showVolume}
                  theme={theme}
                />
              ) : (
                <div className="chart-empty">
                  {loading ? "" : "Choose a stock to see its price history."}
                </div>
              )}
            </div>
            <div className="chart-footer">
              <span>
                {visible?.chart[0]?.date || "—"} <ArrowRight size={12} />{" "}
                {visible?.chart.at(-1)?.date || "—"}
              </span>
              <span>
                {showSma && (
                  <>
                    <i className="legend-line sma20" />
                    20D <i className="legend-line sma50" />
                    50D
                  </>
                )}
                {visible?.performance &&
                  `${compact.format(visible.performance.source_points)} observations`}
              </span>
            </div>
          </Panel>
          <aside className="company-sidebar">
            <Panel loading={loading} label="Company facts">
              <div className="panel-heading">
                <h2>At a glance</h2>
                <span className="subtle">{currency}</span>
              </div>
              <dl className="data-list">
                <div>
                  <dt>Market cap</dt>
                  <dd>
                    {overview?.market_cap
                      ? compact.format(overview.market_cap)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Volume</dt>
                  <dd>{overview ? compact.format(overview.volume) : "—"}</dd>
                </div>
                <div>
                  <dt>Average volume</dt>
                  <dd>
                    {overview ? compact.format(overview.average_volume) : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Day range</dt>
                  <dd>
                    {overview
                      ? `${money(overview.day_low)} – ${money(overview.day_high)}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>52-week range</dt>
                  <dd>
                    {overview
                      ? `${money(overview.week_52_low)} – ${money(overview.week_52_high)}`
                      : "—"}
                  </dd>
                </div>
              </dl>
            </Panel>
            <Panel
              loading={loading}
              label="Research notes"
              className="notes-panel"
            >
              <div className="panel-heading">
                <h2>Research notes</h2>
                <span className="subtle">From the data</span>
              </div>
              <div
                className="note-tabs"
                role="tablist"
                aria-label="Research note"
              >
                {["Summary", "Trend", "Risk", "Models"].map((label, index) => (
                  <button
                    role="tab"
                    id={`note-tab-${index}`}
                    key={label}
                    aria-selected={note === index}
                    aria-controls="research-note"
                    onClick={() => setNote(index)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div
                className="note-copy"
                id="research-note"
                role="tabpanel"
                aria-labelledby={`note-tab-${note}`}
              >
                <p>
                  {visible?.insights[note]?.body ||
                    "Notes will appear when the analysis is ready."}
                </p>
              </div>
            </Panel>
          </aside>
        </div>
        <div className="section-heading" id="technicals">
          <div>
            <h2>A closer look</h2>
            <p>Technical signals and historical risk, without the noise.</p>
          </div>
          <span className="subtle">{selectedPeriod} history</span>
        </div>
        <div className="analysis-grid">
          <Panel loading={loading} label="Technical indicators">
            <div className="panel-heading">
              <h3>Technical indicators</h3>
              <span className="reading">{technical?.signal || "—"}</span>
            </div>
            <div className="indicator-grid">
              <Metric
                label="RSI · 14 days"
                value={number(technical?.rsi, 1)}
                detail="30 oversold · 70 overbought"
              />
              <Metric
                label="MACD"
                value={number(technical?.macd)}
                detail={`Signal ${number(technical?.macd_signal)}`}
              />
              <Metric
                label="20-day average"
                value={money(technical?.sma_20)}
                detail="Short-term trend"
              />
              <Metric
                label="50-day average"
                value={money(technical?.sma_50)}
                detail="Medium-term trend"
              />
              <Metric
                label="10-day momentum"
                value={pct(technical?.momentum_10d, true)}
                detail="Price change"
              />
              <Metric
                label="Average true range"
                value={money(technical?.atr)}
                detail="14-day price range"
              />
            </div>
            <div className="level-row">
              <span>
                Support <strong>{money(technical?.support)}</strong>
              </span>
              <span>
                Resistance <strong>{money(technical?.resistance)}</strong>
              </span>
            </div>
            {technical && (
              <p className="panel-footnote">
                {technical.reasons.slice(0, 2).join(" ")}
              </p>
            )}
          </Panel>
          <Panel loading={loading} label="Historical risk">
            <div className="panel-heading">
              <h3>Historical risk</h3>
              <span className="reading">{risk?.classification || "—"}</span>
            </div>
            <div className="risk-summary">
              <strong>
                {number(risk?.score, 0)}
                <small>/ 100</small>
              </strong>
              <p>
                A weighted score of volatility, drawdowns, and downside risk.
                Lower is less risky in this historical sample.
              </p>
            </div>
            <div
              className="risk-track"
              aria-label={`Risk score ${number(risk?.score, 0)} of 100`}
            >
              <span style={{ width: `${risk?.score || 0}%` }} />
            </div>
            <div className="risk-scale">
              <span>Lower risk</span>
              <span>Higher risk</span>
            </div>
            <dl className="data-list risk-data">
              <div>
                <dt>Beta vs. SPY</dt>
                <dd>{number(stats?.beta)}</dd>
              </div>
              <div>
                <dt>Daily VaR · 95%</dt>
                <dd>{pct(stats?.value_at_risk_95)}</dd>
              </div>
              <div>
                <dt>Recent volatility</dt>
                <dd>{pct(risk?.recent_annualized_volatility)}</dd>
              </div>
              <div>
                <dt>Downside deviation</dt>
                <dd>{pct(stats?.downside_deviation)}</dd>
              </div>
            </dl>
            <details className="method-detail">
              <summary>
                How the score is calculated <ChevronDown size={14} />
              </summary>
              <p>
                {risk?.formula ||
                  "28% volatility + 26% drawdown + 14% beta + 14% daily VaR + 12% downside deviation + 6% volatility regime. Components are normalized to 0–100."}
              </p>
            </details>
          </Panel>
        </div>
        <div className="section-heading" id="models">
          <div>
            <h2>Model comparison</h2>
            <p>Next-close experiments, tested on later unseen observations.</p>
          </div>
          <span className="experimental-label">Experimental</span>
        </div>
        <Panel loading={loading} label="Model results" className="models-panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Next close</th>
                  <th>Estimated range</th>
                  <th>RMSE</th>
                  <th>MAE</th>
                  <th>Direction accuracy</th>
                </tr>
              </thead>
              <tbody>
                {visible?.predictions.models.length ? (
                  visible.predictions.models.map((model) => (
                    <tr key={model.name}>
                      <td>
                        <strong>{model.name}</strong>
                        {model.name === visible.predictions.best_model && (
                          <small className="best-model">
                            Lowest unseen error
                          </small>
                        )}
                      </td>
                      <td>
                        {money(model.latest_prediction)}
                        <small
                          className={
                            model.predicted_change >= 0
                              ? "positive"
                              : "negative"
                          }
                        >
                          {pct(model.predicted_change, true)}
                        </small>
                      </td>
                      <td>
                        {money(model.lower_estimate)} –{" "}
                        {money(model.upper_estimate)}
                      </td>
                      <td>{money(model.rmse)}</td>
                      <td>{money(model.mae)}</td>
                      <td>{pct(model.directional_accuracy)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="empty-models">
                      {!visible
                        ? "Model results will appear here."
                        : visible.predictions.message ||
                          "Not enough history for a reliable holdout. Select a longer range."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {visible?.predictions.models[0] && (
            <div className="model-periods">
              <span>
                Train · {visible.predictions.models[0].training_period}
              </span>
              <span>
                Test · {visible.predictions.models[0].testing_period} (
                {visible.predictions.models[0].test_observations} observations)
              </span>
            </div>
          )}
          <p className="panel-footnote">
            Estimates use historical price and volume only. Live evaluations use
            three chronological windows and separate interval calibration. A
            target coverage is not a guarantee. See the research lab for
            details.
          </p>
        </Panel>
        <ResearchWorkbench
          key={selection.symbol}
          symbol={selection.symbol}
          period={period}
          theme={theme}
          enabled={Boolean(
            data &&
            !loading &&
            !sample &&
            data.overview.symbol === selection.symbol,
          )}
          onEvaluation={acceptEvaluation}
        />
        <details className="statistics-detail">
          <summary>
            More statistics & methodology <ChevronDown size={16} />
          </summary>
          <div className="more-statistics">
            <Metric
              label="Annualized return"
              value={pct(stats?.annualized_return, true)}
              detail="Geometric historical return"
            />
            <Metric
              label="Sharpe ratio"
              value={number(stats?.sharpe_ratio)}
              detail="Return / total volatility"
            />
            <Metric
              label="Sortino ratio"
              value={number(stats?.sortino_ratio)}
              detail="Return / downside deviation"
            />
            <Metric
              label="Calmar ratio"
              value={number(stats?.calmar_ratio)}
              detail="Return / max. drawdown"
            />
            <Metric
              label="Expected shortfall · 95%"
              value={pct(stats?.expected_shortfall_95)}
              detail="Mean return in worst 5% of days"
            />
            <Metric
              label="SPY correlation"
              value={number(stats?.benchmark_correlation)}
              detail="Matched daily returns"
            />
          </div>
          <p>
            Statistics use the full selected history. Large charts are reduced
            to at most 650 points using Largest-Triangle-Three-Buckets sampling.
            Model training is limited to 2,500 recent observations, with
            expanding chronological test windows and a one-row boundary gap.
            Overview returns use daily closing prices; dividends are not
            included. Annualization assumes 252 trading days. Signals and scores
            are formula-based, not recommendations.
          </p>
        </details>
        <footer className="site-footer">
          <span>
            Stock Analysis <span> / </span> A local research workspace
          </span>
          <p>
            {sample
              ? "Synthetic sample · not current market data"
              : "Yahoo Finance data may be delayed."}{" "}
            For research only. Not investment advice.
          </p>
        </footer>
      </main>
    </>
  );
}
