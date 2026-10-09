# Stock Analysis

A stock forecasting project I built to combine machine learning with a full-stack
web app. It uses historical Yahoo Finance prices and volume to predict the next
trading session's closing price, compare models, and explore stock performance.

![Stock Analysis dashboard showing Apple price history and research notes](docs/images/stock-analysis-dashboard.png)

Dashboard screenshot from October 5, 2026; the prices shown are not live quotes.

## Features

- Search companies by name or ticker, with company logos and recent searches.
- Explore price history, volume, moving averages, and Bollinger Bands in a
  responsive dashboard with light and dark themes.
- Forecast closing prices with Linear Regression and Random Forest models,
  including prediction intervals and comparisons against a last-close baseline.
- View technical indicators such as RSI and MACD, alongside volatility,
  drawdown, and other risk metrics.
- Use the research lab to compare stocks, replay a historical date, and simulate
  strategies with fees, slippage, and a buy-and-hold comparison. Export trade
  records as CSV and revisit saved runs.

## Technical approach

The frontend uses **React, TypeScript, Recharts, and Vinext/Vite**. A **Python
FastAPI** backend handles market data, analytics, and forecasting with **pandas,
NumPy, and scikit-learn**.

- **Feature engineering:** 10 time-series features derived from lagged prices,
  returns, moving averages, volatility, and volume changes.
- **Model evaluation:** three expanding chronological windows, rather than
  shuffled data. Models are compared using forecast error and interval coverage;
  a separate calibration slice is used for prediction intervals.
- **Background processing:** model training runs through a bounded, single-worker
  queue instead of blocking dashboard requests. SQLite stores jobs, results, and
  dataset snapshots; fitted models are saved as local artifacts.
- **Chart performance:** Largest-Triangle-Three-Buckets downsampling limits charts
  to 650 points. TTL/LRU caches, debounced search, cancelled stale requests, and
  memoized charts reduce repeated work.

The main code lives in `app/` (dashboard and research UI),
`backend/app/services/` (data, models, analytics, and storage), and
`scripts/run.mjs` (local startup).

## Run locally

Requires **Node.js 22.13+**, **Python 3.10+**, and an internet connection for
Yahoo Finance data. Run these commands from the repository root.

### Windows / PowerShell

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm.cmd install
npm.cmd run dev
```

Use `npm.cmd` if PowerShell blocks `npm.ps1` because scripts are disabled.

### macOS / Linux

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
npm install
npm run dev
```

The startup command launches both the website and Python API. Open the printed
website URL, normally `http://localhost:3000`. If that port is occupied, the
website uses another port. Ctrl+C stops both services. Frontend edits reload
automatically; restart the command after backend edits.

The API runs on port **8010** by default. If Windows blocks that port:

```powershell
$env:STOCK_API_PORT = "8020"
npm.cmd run dev
```

For a separately running API, set `STOCK_API_URL` to its origin and use
`npm.cmd run dev:web` (or `npm run dev:web`). Interactive API documentation is
available at `http://127.0.0.1:8010/docs` with the default port.

## Notes and limitations

Saved research and cached data live in `backend/.cache/`, which is not committed
to Git. Keep this directory to retain your experiments. `STOCK_RESEARCH_DIR`
can point to another location for research storage. Use one API process per
research database.

This is a learning project, not a trading system or financial advice. Forecasts
only use historical prices and volume; they cannot anticipate news or unexpected
events. Daily data may be delayed or incomplete, and historical replay uses
today's provider history, which can include later corrections and adjustments.
Simulations do not fully account for real-world execution or market impact.

Keep the prototype local. The Vinext toolchain has unresolved dependency security
advisories; run `npm.cmd audit` (or `npm audit`) and address them before deployment.
