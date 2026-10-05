"""Opt-in live smoke test. Start the app first; never run this in the offline test suite."""
import argparse
import json
import time
from datetime import date, timedelta
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8010")
    parser.add_argument("--symbol", default="CIEN")
    args = parser.parse_args()
    base = args.url.rstrip("/")

    def request(path, body=None, raw=False):
        data = json.dumps(body).encode() if body is not None else None
        with urlopen(Request(base + path, data=data, headers={"Content-Type": "application/json"}), timeout=90) as response:
            content = response.read().decode()
        return content if raw else json.loads(content)

    def completed(params):
        started = time.perf_counter()
        job = request("/api/jobs", params)
        stage = None
        while job["status"] not in {"completed", "failed"}:
            if job["stage"] != stage:
                stage = job["stage"]
                print(f"{params['kind']}: {job['progress']}% {stage}", flush=True)
            if time.perf_counter() - started > 300:
                raise TimeoutError("Research run exceeded five minutes.")
            time.sleep(1)
            job = request("/api/jobs/" + job["id"])
        if job["status"] != "completed":
            raise RuntimeError(job["error"])
        print(f"{params['kind']}: saved {job['id'][:8]} in {time.perf_counter() - started:.1f}s", flush=True)
        return job

    assert request("/api/health")["status"] == "ok"
    dashboard_started = time.perf_counter()
    dashboard = request(f"/api/stocks/{args.symbol}/dashboard?period=1y")
    assert dashboard["predictions"]["status"] == "pending"
    print(f"Dashboard loaded without training in {time.perf_counter() - dashboard_started:.1f}s", flush=True)
    params = {"kind": "analysis", "symbols": [args.symbol, "MSFT", "AAPL"], "period": "1y"}
    evaluation = completed(params)
    assert len(evaluation["result"]["results"]) == 3
    assert all(result["status"] == "complete" and len(result["models"]) == 3 for result in evaluation["result"]["results"])
    repeated = request("/api/jobs", params)
    if int(evaluation["created_at"] // 900) == int(repeated["created_at"] // 900):
        assert repeated["reused"] and repeated["id"] == evaluation["id"]
    cutoff = (date.fromisoformat(dashboard["overview"]["as_of"]) - timedelta(days=365)).isoformat()
    replay = completed({"kind": "replay", "symbols": [args.symbol], "period": "5y", "as_of": cutoff})
    frozen = replay["result"]["results"][0]
    assert max(point["date"] for point in frozen["chart"]) <= cutoff
    assert "prices" not in frozen
    assert request(f"/api/replays/{replay['id']}/reveal?steps=1")["steps"] == 1
    backtest = completed({"kind": "backtest", "symbols": [args.symbol], "period": "5y", "strategy": "ml", "fee_bps": 5, "slippage_bps": 5})
    simulation = backtest["result"]["results"][0]
    assert simulation["sessions"] >= 20
    assert all(order["training_cutoff"] <= order["signal_date"] for order in simulation["ledger"])
    assert request(f"/api/jobs/{backtest['id']}/ledger", raw=True).startswith("signal_date,execution_date")
    assert any(job["id"] == backtest["id"] for job in request("/api/jobs")["jobs"])
    print("PASS: 3-stock evaluation, reuse, frozen replay, explicit reveal, ML backtest, ledger export, saved runs.", flush=True)


if __name__ == "__main__":
    main()
