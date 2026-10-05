# Stock Analysis

Stock Analysis is a local-first stock research prototype that combines Yahoo Finance
market data, transparent statistical analysis, rule-based technical signals,
historical risk scoring, chronological machine-learning evaluation, and
metric-grounded narrative insights.

The application is intentionally careful with forecasts: models are evaluated
on later, unseen observations, no time-series rows are shuffled, uncertainty
ranges are displayed, and all estimates are labeled experimental.

## What is included

- Search by ticker or company name, with recent searches stored in the browser
- Debounced autocomplete for company names such as Ciena → CIEN
- Yahoo Finance company overview and historical OHLCV data
- Interactive ranges from one month through maximum available history
- Moving-average and Bollinger Band overlays
- Return, volatility, drawdown, Sharpe, Sortino, Calmar, VaR, expected
  shortfall, beta, and SPY correlation metrics
- RSI, MACD, ATR, momentum, support/resistance, and crossover signals
- A published weighted risk-score formula
- Linear Regression and Random Forest models using chronological holdouts
- MAE, RMSE, directional accuracy, forecast ranges, and execution time
- Deterministic insight text composed only from calculated metrics
- Company logos in search results and the selected company header, with initials as a fallback
- Explicit sample mode when the local API is offline (never silently substituted)
- Responsive light and dark themes with a saved browser preference
- In-card loading states, measured logo transitions, and left-to-right chart reveal motion
- One-command startup for the dashboard and local API

## Performance design

- Large histories are reduced to at most 650 rendered points with the
  linear-time Largest-Triangle-Three-Buckets algorithm, preserving peaks and
  turning points instead of naively dropping every nth row.
- Yahoo history, company search, overview data, and complete dashboard
  responses use bounded TTL/LRU caches with O(1) lookup and eviction.
- Dashboard JSON is gzip-compressed, stale browser requests are cancelled, and
  company-name lookup is debounced.
- The chart is memoized so typing in search does not rerender thousands of SVG
  nodes. Expensive per-point chart tweening is replaced by one composited
  left-to-right reveal.
- Model training uses the latest 2,500 valid chronological observations, which
  bounds runtime without shuffling or leaking future data.

NumPy, pandas, and scikit-learn already execute their heavy numerical kernels
in compiled native code. A separate C/C++ service would add deployment and
memory-safety complexity without improving the browser's graph-rendering
bottleneck.

## Project structure

```text
app/                         React/TypeScript dashboard
backend/
  app/main.py                FastAPI endpoints
  app/services/
    market_data.py           Yahoo Finance retrieval and normalization
    analytics.py             Statistics, indicators, and risk scoring
    prediction.py            Feature engineering and model evaluation
    insights.py              Metric-grounded narrative composer
  tests/                     Analytics unit tests
public/                      Browser and social-preview assets
```

## Prerequisites

- Node.js 22.13 or newer
- Python 3.10 or newer

## Run locally

Use a terminal in the repository root. First-time setup:

### 1. Install dependencies

PowerShell:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm.cmd install
```

macOS or Linux:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
npm install
```

### 2. Start the app

PowerShell (use `npm.cmd` to avoid Windows blocking `npm.ps1`):

```powershell
npm.cmd run dev
```

```bash
npm run dev
```

That command starts **both** the API and the website. Open the local URL printed
by the web server (normally `http://localhost:3000`). If port 3000 is occupied, it
will print a different port. Ctrl+C stops the services started by this command.
The website hot-reloads frontend edits. Restart the command after backend edits.

The browser uses same-origin `/api` requests; the server forwards them to the
local Python API. The default API port is 8010. If Windows blocks it:

```powershell
$env:STOCK_API_PORT = "8020"
npm.cmd run dev
```

To use an API that is already running elsewhere, set `STOCK_API_URL` to its
origin (for example `http://127.0.0.1:8000`). This is a server-only setting.
`npm.cmd run dev:web` starts just the website when you manage the API separately.
API health: `/api/health` on the website; interactive API docs:
`http://127.0.0.1:8010/docs`.

Yahoo Finance must be reachable for live data. Provider cookies and timezone
data are cached inside ignored `backend/.cache/`, rather than a user-profile
folder. Company icons are retrieved from company website favicons via Google's
fixed image endpoint and cached for 24 hours. Some companies do not have a
usable icon; their initial remains visible instead of a broken image.

## Verification

```powershell
$env:PYTHONPATH = "backend"
backend/.venv/Scripts/python.exe -m pytest backend/tests -q
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd test
```

## API surface

- `GET /api/health`
- `GET /api/stocks/search?q=apple`
- `GET /api/stocks/AAPL/dashboard?period=1y`
- `GET /api/stocks/AAPL/logo`

Supported periods are `1m`, `3mo`, `6mo`, `1y`, `5y`, and `max`.

## Risk formula

The overall score is not an AI opinion. It uses:

- 28% annualized volatility
- 26% maximum drawdown
- 14% beta
- 14% 95% daily Value at Risk
- 12% downside deviation
- 6% recent-versus-long-term volatility regime

Each component is normalized to a 0–100 scale before weighting.

## Forecast limitations

Forecasts are experiments based on historical prices, volume, and derived
features. They cannot anticipate news, earnings surprises, macroeconomic
shocks, liquidity changes, or other unexpected events. Past performance does
not guarantee future results. Stock Analysis does not provide financial advice.

## Design direction

The interface emphasizes the company, price, and a readable chart. Volume has
its own pane instead of obscuring the price line. Summary metrics are plain
rows; detailed indicators and model evaluation sit lower on the page. The
existing purple trend mark is preserved. Non-functional account, notification,
and settings controls have been removed.

Reference interfaces: [TradingView stock overview](https://www.tradingview.com/symbols/NASDAQ-AAPL/)
and [Koyfin graphing and financial analysis](https://www.koyfin.com/features/).

## Dependency security

Compatible React and Next.js security patches are installed. The dependency
audit still reports nine high-severity advisories in the current Vinext toolchain
(image parsing and glob-pattern denial of service). Resolving these requires a
separately tested framework migration. Keep this prototype local; do not expose
the development server publicly. Run `npm.cmd audit` before any deployment.
