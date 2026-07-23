# Northstar

Northstar is a local-first stock research prototype that combines Yahoo Finance
market data, transparent statistical analysis, rule-based technical signals,
historical risk scoring, chronological machine-learning evaluation, and
metric-grounded narrative insights.

The application is intentionally careful with forecasts: models are evaluated
on later, unseen observations, no time-series rows are shuffled, uncertainty
ranges are displayed, and all estimates are labeled experimental.

## What is included

- Search by ticker or company name, with recent searches stored in the browser
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
- Embedded demo data for a useful UI when the local API is offline
- Responsive dark-mode UI with loading and error states

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

Open two terminals from the repository root.

### 1. Start the API

PowerShell:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
$env:PYTHONPATH = "backend"
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

macOS or Linux:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
PYTHONPATH=backend backend/.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

The API and interactive documentation are available at:

- `http://127.0.0.1:8000/api/health`
- `http://127.0.0.1:8000/docs`

### 2. Start the dashboard

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Set `NEXT_PUBLIC_API_URL` only if the API is running somewhere other than
`http://127.0.0.1:8000`.

## Verification

```powershell
$env:PYTHONPATH = "backend"
backend/.venv/Scripts/python.exe -m pytest backend/tests -q
npm run build
```

## API surface

- `GET /api/health`
- `GET /api/stocks/search?q=apple`
- `GET /api/stocks/AAPL/dashboard?period=1y`

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
not guarantee future results. Northstar does not provide financial advice.
