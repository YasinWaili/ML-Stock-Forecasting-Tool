"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  Command,
  Gauge,
  Info,
  LineChart,
  Menu,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Star,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import {
  FormEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { demoData } from "./demo-data";
import type { ChartPoint, DashboardData, StockSearchResult } from "./types";

const periods = [
  ["1m", "1M"],
  ["3mo", "3M"],
  ["6mo", "6M"],
  ["1y", "1Y"],
  ["5y", "5Y"],
  ["max", "MAX"],
];
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const money = (value: number, digits = 2) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
const percent = (value: number, digits = 1) =>
  `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
const compact = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);

function ContainerLoader({
  label = "Calculating",
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "container-loader compact" : "container-loader"} aria-hidden="true">
      <div className="loader-skeleton">
        <span />
        <span />
        {!compact && <span />}
      </div>
      <div className="loader-status">
        <i />
        <small>{label}</small>
      </div>
    </div>
  );
}

const MetricCard = memo(function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
  icon,
  loading = false,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative" | "neutral" | "amber";
  icon: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <article className={loading ? "metric-card loading-surface" : "metric-card"}>
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div>
        <span className="eyebrow">{label}</span>
        <strong className={`metric-value ${tone}`}>{value}</strong>
        <span className="metric-detail">{detail}</span>
      </div>
      {loading && <ContainerLoader compact label="Updating" />}
    </article>
  );
});

function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const close = payload.find((item) => item.dataKey === "close");
  return (
    <div className="chart-tip">
      <span>{label ? new Date(`${label}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
      <strong>{close?.value ? money(close.value) : "—"}</strong>
      <small>Close price</small>
    </div>
  );
}

const PriceChart = memo(function PriceChart({
  points,
  chartMin,
  chartMax,
  showSma,
  showBands,
  loading,
}: {
  points: ChartPoint[];
  chartMin: number;
  chartMax: number;
  showSma: boolean;
  showBands: boolean;
  loading: boolean;
}) {
  return (
    <div className={loading ? "chart-wrap loading" : "chart-wrap graph-reveal"}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 12, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b7cff" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#8b7cff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#252937" strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            minTickGap={42}
            tick={{ fill: "#747b8e", fontSize: 11 }}
            tickFormatter={(value) =>
              new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
                month: "short",
              })
            }
          />
          <YAxis
            yAxisId="price"
            orientation="right"
            domain={[chartMin, chartMax]}
            axisLine={false}
            tickLine={false}
            width={46}
            tick={{ fill: "#747b8e", fontSize: 11 }}
            tickFormatter={(value) => `$${value}`}
          />
          <YAxis yAxisId="volume" hide domain={[0, "dataMax * 4"]} />
          <ChartTooltip
            content={<ChartTip />}
            cursor={{ stroke: "#7267f0", strokeDasharray: "4 4" }}
          />
          <Bar
            yAxisId="volume"
            dataKey="volume"
            fill="#30364a"
            opacity={0.45}
            isAnimationActive={false}
          />
          {showBands && (
            <Line
              yAxisId="price"
              dataKey="upper_band"
              stroke="#3ea6ff"
              strokeOpacity={0.45}
              strokeDasharray="4 5"
              dot={false}
              isAnimationActive={false}
            />
          )}
          {showBands && (
            <Line
              yAxisId="price"
              dataKey="lower_band"
              stroke="#3ea6ff"
              strokeOpacity={0.45}
              strokeDasharray="4 5"
              dot={false}
              isAnimationActive={false}
            />
          )}
          <Area
            yAxisId="price"
            type="monotone"
            dataKey="close"
            stroke="#9a8cff"
            strokeWidth={2.4}
            fill="url(#priceFill)"
            dot={false}
            activeDot={{ r: 4, fill: "#b8afff", stroke: "#11131a", strokeWidth: 2 }}
            isAnimationActive={false}
          />
          {showSma && (
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="sma20"
              stroke="#32c7a0"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {showSma && (
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="sma50"
              stroke="#e5a94d"
              strokeWidth={1.4}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {loading && <ContainerLoader label="Sampling & analyzing" />}
    </div>
  );
});

export default function StockDashboard() {
  const [data, setData] = useState<DashboardData>(demoData);
  const [symbol, setSymbol] = useState("AAPL");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("1y");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isDemo, setIsDemo] = useState(true);
  const [showSma, setShowSma] = useState(true);
  const [showBands, setShowBands] = useState(false);
  const [activeInsight, setActiveInsight] = useState(0);
  const [recent, setRecent] = useState<string[]>(["MSFT", "NVDA"]);
  const [mobileNav, setMobileNav] = useState(false);
  const [suggestions, setSuggestions] = useState<StockSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [transitionStock, setTransitionStock] = useState<StockSearchResult | null>(null);
  const [identityPhase, setIdentityPhase] = useState<"launch" | "dock">("launch");
  const dashboardAbortRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);

  const loadStock = useCallback(
    async (
      ticker: string,
      selectedPeriod: string,
      identity?: StockSearchResult,
    ) => {
      dashboardAbortRef.current?.abort();
      const controller = new AbortController();
      dashboardAbortRef.current = controller;
      const requestSequence = ++requestSequenceRef.current;
      const startedAt = Date.now();
      const pendingIdentity = identity ?? {
        symbol: ticker.toUpperCase(),
        name: ticker.toUpperCase(),
        exchange: "",
        type: "EQUITY",
      };

      setTransitionStock(pendingIdentity);
      setIdentityPhase("launch");
      setLoading(true);
      setError("");
      window.setTimeout(() => setIdentityPhase("dock"), 30);

      try {
        const response = await fetch(
          `${API_BASE}/api/stocks/${encodeURIComponent(ticker)}/dashboard?period=${selectedPeriod}&max_points=650`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.detail || "That symbol could not be loaded.");
        }
        const payload = (await response.json()) as DashboardData;
        const remainingMotionTime = Math.max(0, 520 - (Date.now() - startedAt));
        if (remainingMotionTime) {
          await new Promise((resolve) => window.setTimeout(resolve, remainingMotionTime));
        }
        if (requestSequence !== requestSequenceRef.current) return;

        setData(payload);
        setSymbol(payload.overview.symbol);
        setIsDemo(false);
        setRecent((current) => {
          const next = [
            payload.overview.symbol,
            ...current.filter((item) => item !== payload.overview.symbol),
          ].slice(0, 5);
          localStorage.setItem("northstar-recent", JSON.stringify(next));
          return next;
        });
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (requestSequence !== requestSequenceRef.current) return;
        setError(caught instanceof Error ? caught.message : "Market data is unavailable.");
        setIsDemo(true);
      } finally {
        if (requestSequence === requestSequenceRef.current) {
          setLoading(false);
          window.setTimeout(() => {
            if (requestSequence === requestSequenceRef.current) {
              setTransitionStock(null);
            }
          }, 260);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const cleaned = query.trim();
    if (cleaned.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(
          `${API_BASE}/api/stocks/search?q=${encodeURIComponent(cleaned)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Search is temporarily unavailable.");
        const payload = (await response.json()) as { results?: StockSearchResult[] };
        setSuggestions((payload.results ?? []).slice(0, 6));
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 240);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const saved = localStorage.getItem("northstar-recent");
    if (saved) {
      try {
        setRecent(JSON.parse(saved));
      } catch {
        localStorage.removeItem("northstar-recent");
      }
    }
    void loadStock("AAPL", "1y");
  }, [loadStock]);

  const chooseStock = useCallback(
    (result: StockSearchResult) => {
      setQuery("");
      setSuggestions([]);
      setSearchFocused(false);
      void loadStock(result.symbol, period, result);
    },
    [loadStock, period],
  );

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    const cleaned = query.trim();
    if (!cleaned) {
      setError("Enter a ticker or company name.");
      return;
    }
    let match: StockSearchResult | undefined = suggestions.at(0);
    if (!match) {
      const response = await fetch(
        `${API_BASE}/api/stocks/search?q=${encodeURIComponent(cleaned)}`,
      ).catch(() => null);
      if (response?.ok) {
        const payload = (await response.json()) as { results?: StockSearchResult[] };
        match = payload.results?.[0];
      }
    }
    chooseStock(
      match ?? {
        symbol: cleaned.toUpperCase(),
        name: cleaned,
        exchange: "",
        type: "EQUITY",
      },
    );
  }

  function selectPeriod(next: string) {
    setPeriod(next);
    void loadStock(symbol, next);
  }

  const positive = data.overview.change >= 0;
  const bestModel = data.predictions.models.find(
    (model) => model.name === data.predictions.best_model,
  );
  const [chartMin, chartMax] = useMemo(() => {
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (const point of data.chart) {
      minimum = Math.min(minimum, point.lower_band ?? point.close);
      maximum = Math.max(maximum, point.upper_band ?? point.close);
    }
    return [Math.floor(minimum * 0.97), Math.ceil(maximum * 1.03)];
  }, [data.chart]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Northstar home">
          <span className="brand-mark"><TrendingUp size={19} strokeWidth={2.4} /></span>
          <span>northstar<span className="brand-dot">.</span></span>
        </a>
        <nav className={mobileNav ? "main-nav open" : "main-nav"} aria-label="Primary navigation">
          <a className="active" href="#overview">Overview</a>
          <a href="#technicals">Technicals</a>
          <a href="#models">Models</a>
          <a href="#insights">Insights</a>
        </nav>
        <div className="top-actions">
          <button className="icon-button" aria-label="Notifications"><Bell size={18} /></button>
          <button className="icon-button" aria-label="Settings"><Settings size={18} /></button>
          <div className="avatar">YW</div>
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMobileNav((open) => !open)}
          >
            {mobileNav ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      <main>
        <section className="command-row" aria-label="Stock search">
          <div className="search-area">
            <form className="search-box" onSubmit={submitSearch}>
              <Search size={19} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => window.setTimeout(() => setSearchFocused(false), 140)}
                placeholder="Search Ciena, Apple, Microsoft, or a ticker..."
                aria-label="Search a company or ticker"
                aria-autocomplete="list"
                aria-expanded={searchFocused && (suggestions.length > 0 || searching)}
                autoComplete="off"
              />
              {searching ? (
                <span className="search-spinner" />
              ) : (
                <span className="key-hint"><Command size={12} /> K</span>
              )}
            </form>
            {searchFocused && (suggestions.length > 0 || searching) && (
              <div className="search-results" role="listbox" aria-label="Stock suggestions">
                {searching && suggestions.length === 0 ? (
                  <div className="search-result-loading">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : (
                  suggestions.map((result) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected="false"
                      key={`${result.symbol}-${result.exchange}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseStock(result)}
                    >
                      <span className="result-logo">
                        {result.symbol.slice(0, 1)}
                        {result.logo_url && <img src={result.logo_url} alt="" />}
                      </span>
                      <span className="result-copy">
                        <strong>{result.name}</strong>
                        <small>{result.symbol} · {result.exchange || result.type}</small>
                      </span>
                      <ArrowRight size={15} />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="recent-list">
            <span>Recent</span>
            {recent.slice(0, 3).map((item) => (
              <button key={item} onClick={() => void loadStock(item, period)}>{item}</button>
            ))}
          </div>
        </section>

        {error && (
          <div className="notice" role="status">
            <Info size={16} />
            <span>{error} Showing the embedded AAPL demo snapshot until the local API responds.</span>
            <button onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button>
          </div>
        )}

        <section className={loading ? "stock-hero identity-loading" : "stock-hero"} id="overview">
          {transitionStock && (
            <div className={`identity-flight ${identityPhase}`} aria-live="polite">
              <div className="company-logo">
                {transitionStock.symbol.slice(0, 1)}
                {transitionStock.logo_url && <img src={transitionStock.logo_url} alt="" />}
              </div>
              <div>
                <strong>{transitionStock.name}</strong>
                <span>{transitionStock.symbol}</span>
              </div>
            </div>
          )}
          <div className="company-block">
            <div className="company-logo">
              {data.overview.symbol.slice(0, 1)}
              {data.overview.logo_url && <img src={data.overview.logo_url} alt="" />}
            </div>
            <div>
              <div className="company-line">
                <h1>{data.overview.name}</h1>
                <span className="ticker-badge">{data.overview.symbol}</span>
                <button className="star-button" aria-label="Add to watchlist"><Star size={18} /></button>
              </div>
              <p>{data.overview.exchange} · {data.overview.sector} · {data.overview.currency}</p>
            </div>
          </div>
          <div className="price-block">
            <span className="market-state"><CircleDot size={12} /> {data.overview.market_state === "REGULAR" ? "Market open" : "Market closed"} · As of {data.overview.as_of}</span>
            <div className="price-line">
              <strong>{money(data.overview.price)}</strong>
              <span className={positive ? "change positive" : "change negative"}>
                {positive ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                {positive ? "+" : ""}{money(data.overview.change)} ({percent(data.overview.change_percent)})
              </span>
            </div>
            <span className="source-label">{isDemo ? "Demo snapshot" : `Source: ${data.overview.source}`}</span>
          </div>
        </section>

        <section className="metrics-grid">
          <MetricCard
            label="Annualized return"
            value={percent(data.statistics.annualized_return)}
            detail={`${percent(data.statistics.cumulative_return)} total in range`}
            tone={data.statistics.annualized_return >= 0 ? "positive" : "negative"}
            icon={<TrendingUp size={18} />}
            loading={loading}
          />
          <MetricCard
            label="Annualized volatility"
            value={`${(data.statistics.annualized_volatility * 100).toFixed(1)}%`}
            detail={`Recent ${(data.risk.recent_annualized_volatility * 100).toFixed(1)}%`}
            tone="amber"
            icon={<Activity size={18} />}
            loading={loading}
          />
          <MetricCard
            label="Risk score"
            value={`${data.risk.score.toFixed(0)} / 100`}
            detail={`${data.risk.classification} historical risk`}
            tone="amber"
            icon={<Gauge size={18} />}
            loading={loading}
          />
          <MetricCard
            label="Max drawdown"
            value={`${(data.statistics.maximum_drawdown * 100).toFixed(1)}%`}
            detail="Peak-to-trough in range"
            tone="negative"
            icon={<ArrowDownRight size={18} />}
            loading={loading}
          />
          <MetricCard
            label="Technical trend"
            value={data.technical.signal}
            detail={`RSI ${data.technical.rsi.toFixed(1)}`}
            tone={data.technical.signal.toLowerCase().includes("bull") ? "positive" : "neutral"}
            icon={<LineChart size={18} />}
            loading={loading}
          />
          <MetricCard
            label="Best holdout model"
            value={data.predictions.best_model || "Not available"}
            detail={bestModel ? `RMSE ${money(bestModel.rmse)}` : "Needs more history"}
            icon={<BrainCircuit size={18} />}
            loading={loading}
          />
        </section>

        <div className="primary-grid">
          <section className={loading ? "panel chart-panel loading-panel" : "panel chart-panel"}>
            <div className="panel-head">
              <div>
                <span className="section-kicker">Market performance</span>
                <h2>Price history</h2>
              </div>
              <div className="period-tabs" aria-label="Chart time range">
                {periods.map(([value, label]) => (
                  <button
                    key={value}
                    className={period === value ? "active" : ""}
                    onClick={() => selectPeriod(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="chart-controls">
              <button className={showSma ? "chip active" : "chip"} onClick={() => setShowSma((value) => !value)}>
                <span className="legend-dot violet" /> Moving averages
              </button>
              <button className={showBands ? "chip active" : "chip"} onClick={() => setShowBands((value) => !value)}>
                <span className="legend-dot blue" /> Bollinger bands
              </button>
              <span className="chart-range">
                {data.performance
                  ? `${data.performance.rendered_points.toLocaleString()} of ${data.performance.source_points.toLocaleString()} points`
                  : `${money(chartMin, 0)} — ${money(chartMax, 0)}`}
              </span>
            </div>
            <PriceChart
              points={data.chart}
              chartMin={chartMin}
              chartMax={chartMax}
              showSma={showSma}
              showBands={showBands}
              loading={loading}
            />
            <div className="ohlc-row">
              <span>Open <strong>{money(data.overview.open)}</strong></span>
              <span>High <strong>{money(data.overview.day_high)}</strong></span>
              <span>Low <strong>{money(data.overview.day_low)}</strong></span>
              <span>Prev. close <strong>{money(data.overview.previous_close)}</strong></span>
              <span>Volume <strong>{compact(data.overview.volume)}</strong></span>
              <span>Avg. volume <strong>{compact(data.overview.average_volume)}</strong></span>
            </div>
          </section>

          <aside className={loading ? "panel insight-panel loading-panel" : "panel insight-panel"} id="insights">
            <div className="panel-head">
              <div>
                <span className="section-kicker purple"><Sparkles size={13} /> Grounded insights</span>
                <h2>Analysis brief</h2>
              </div>
              <span className="ai-badge">METRIC-BASED</span>
            </div>
            <div className="insight-nav">
              {data.insights.map((insight, index) => (
                <button
                  key={insight.title}
                  className={activeInsight === index ? "active" : ""}
                  onClick={() => setActiveInsight(index)}
                  aria-label={`Show ${insight.title}`}
                >
                  {index + 1}
                </button>
              ))}
            </div>
            <article className="insight-copy">
              <span className="insight-number">0{activeInsight + 1}</span>
              <h3>{data.insights[activeInsight]?.title}</h3>
              <p>{data.insights[activeInsight]?.body}</p>
            </article>
            <div className="signal-list">
              <div><span>Trend</span><strong className="positive">{data.technical.signal}</strong></div>
              <div><span>Risk regime</span><strong>{data.risk.classification}</strong></div>
              <div><span>Model agreement</span><strong>{data.predictions.models.length > 1 ? "Mixed-positive" : "Pending"}</strong></div>
            </div>
            <div className="limitation-note">
              <ShieldAlert size={18} />
              <p><strong>Know the limits.</strong> These observations explain calculated values. They are not personalized financial advice or guaranteed forecasts.</p>
            </div>
            <button className="text-button">Read methodology <ArrowRight size={15} /></button>
            {loading && <ContainerLoader label="Writing grounded brief" />}
          </aside>
        </div>

        <div className="analysis-grid" id="technicals">
          <section className={loading ? "panel technical-panel loading-panel" : "panel technical-panel"}>
            <div className="panel-head">
              <div>
                <span className="section-kicker">Rule-based signals</span>
                <h2>Technical snapshot</h2>
              </div>
              <span className="status-pill positive"><Check size={13} /> {data.technical.signal}</span>
            </div>
            <div className="indicator-grid">
              {[
                ["RSI · 14D", data.technical.rsi.toFixed(1), data.technical.rsi > 70 ? "Overbought" : data.technical.rsi < 30 ? "Oversold" : "Neutral"],
                ["MACD", data.technical.macd.toFixed(2), data.technical.macd > data.technical.macd_signal ? "Above signal" : "Below signal"],
                ["SMA · 20D", money(data.technical.sma_20), data.overview.price > data.technical.sma_20 ? "Price above" : "Price below"],
                ["SMA · 50D", money(data.technical.sma_50), data.overview.price > data.technical.sma_50 ? "Price above" : "Price below"],
                ["ATR · 14D", money(data.technical.atr), "Daily range"],
                ["Momentum · 10D", percent(data.technical.momentum_10d), "Rate of change"],
              ].map(([label, value, note]) => (
                <div className="indicator" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>{note}</small>
                </div>
              ))}
            </div>
            <div className="levels">
              <div><span>Support zone</span><strong>{money(data.technical.support)}</strong><i style={{ width: "38%" }} /></div>
              <div><span>Current price</span><strong>{money(data.overview.price)}</strong><i className="current" style={{ width: "68%" }} /></div>
              <div><span>Resistance zone</span><strong>{money(data.technical.resistance)}</strong><i className="resistance" style={{ width: "82%" }} /></div>
            </div>
            {loading && <ContainerLoader label="Calculating indicators" />}
          </section>

          <section className={loading ? "panel risk-panel loading-panel" : "panel risk-panel"}>
            <div className="panel-head">
              <div>
                <span className="section-kicker">Transparent scoring</span>
                <h2>Historical risk</h2>
              </div>
              <button className="info-button" title={data.risk.formula}><Info size={16} /></button>
            </div>
            <div className="risk-overview">
              <div className="risk-gauge" style={{ "--risk": `${data.risk.score * 3.6}deg` } as React.CSSProperties}>
                <div><strong>{data.risk.score.toFixed(0)}</strong><span>/ 100</span></div>
              </div>
              <div>
                <span className="status-pill amber">{data.risk.classification} risk</span>
                <p>Calculated from six historical dimensions with a published weighted formula.</p>
              </div>
            </div>
            <div className="risk-bars">
              {[
                ["Volatility", data.risk.volatility_score],
                ["Drawdown", data.risk.drawdown_score],
                ["Market sensitivity", data.risk.beta_score],
                ["Tail loss", data.risk.value_at_risk_score],
              ].map(([label, score]) => (
                <div key={String(label)}>
                  <span>{label}</span>
                  <div><i style={{ width: `${score}%` }} /></div>
                  <strong>{Number(score).toFixed(0)}</strong>
                </div>
              ))}
            </div>
            <div className="risk-foot">
              <span>Beta vs SPY <strong>{data.statistics.beta.toFixed(2)}</strong></span>
              <span>95% daily VaR <strong>{(data.statistics.value_at_risk_95 * 100).toFixed(2)}%</strong></span>
              <span>Sharpe ratio <strong>{data.statistics.sharpe_ratio.toFixed(2)}</strong></span>
            </div>
            {loading && <ContainerLoader label="Scoring historical risk" />}
          </section>
        </div>

        <section className={loading ? "panel models-panel loading-panel" : "panel models-panel"} id="models">
          <div className="panel-head">
            <div>
              <span className="section-kicker"><BrainCircuit size={13} /> Chronological holdout</span>
              <h2>Model comparison</h2>
            </div>
            <div className="model-summary">
              <Zap size={15} />
              <span>Best in this run</span>
              <strong>{data.predictions.best_model || "Pending"}</strong>
            </div>
          </div>
          {data.predictions.models.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>MAE</th>
                    <th>RMSE</th>
                    <th>Direction</th>
                    <th>Next estimate</th>
                    <th>Range</th>
                    <th>Runtime</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.predictions.models.map((model) => (
                    <tr key={model.name}>
                      <td>
                        <span className="model-name"><BarChart3 size={17} /> {model.name}</span>
                        <small>{model.test_observations} unseen sessions</small>
                      </td>
                      <td>{money(model.mae)}</td>
                      <td>{money(model.rmse)}</td>
                      <td>{(model.directional_accuracy * 100).toFixed(1)}%</td>
                      <td><strong>{money(model.latest_prediction)}</strong><small className={model.predicted_change >= 0 ? "positive" : "negative"}>{percent(model.predicted_change)}</small></td>
                      <td>{money(model.lower_estimate)} – {money(model.upper_estimate)}</td>
                      <td><Clock3 size={13} /> {model.execution_ms.toFixed(0)}ms</td>
                      <td><span className="status-pill success"><Check size={12} /> Complete</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">{data.predictions.message}</p>
          )}
          <div className="model-disclaimer">
            <Info size={16} />
            <span>Experimental estimates based on historical data only. Earlier observations train each model; later observations evaluate it. No rows are randomly shuffled.</span>
          </div>
          {loading && <ContainerLoader label="Evaluating chronological models" />}
        </section>

        <footer>
          <div className="brand">
            <span className="brand-mark small"><TrendingUp size={15} /></span>
            <span>northstar<span className="brand-dot">.</span></span>
          </div>
          <p>Research signals, made legible. Not financial advice.</p>
          <div><a href="#"><BookOpen size={14} /> Methodology</a><a href="#"><ShieldAlert size={14} /> Disclosures</a></div>
        </footer>
      </main>
    </div>
  );
}
