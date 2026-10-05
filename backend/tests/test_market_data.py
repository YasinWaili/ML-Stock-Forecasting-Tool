from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.main import normalize_symbol, search_stocks
from app.services import market_data


def test_search_resolves_names_and_includes_logo(monkeypatch):
    market_data._search_cache.clear()
    monkeypatch.setattr(market_data.yf, "Search", lambda *args, **kwargs: SimpleNamespace(quotes=[
        {"symbol": "CIEN", "shortname": "Ciena Corporation", "quoteType": "EQUITY", "exchDisp": "NYSE"},
        {"symbol": "OTHER", "quoteType": "CRYPTOCURRENCY"},
    ]))
    result = market_data.search_symbols("Ciena")
    assert result == [{"symbol": "CIEN", "name": "Ciena Corporation", "exchange": "NYSE", "type": "EQUITY", "logo_url": "/api/stocks/CIEN/logo"}]


def test_no_match_does_not_invent_ticker(monkeypatch):
    market_data._search_cache.clear()
    monkeypatch.setattr(market_data.yf, "Search", lambda *args, **kwargs: SimpleNamespace(quotes=[]))
    assert market_data.search_symbols("Imaginary Company") == []


def test_search_failure_is_not_cached_as_a_fake_result(monkeypatch):
    market_data._search_cache.clear()
    def fail(*args, **kwargs):
        raise OSError("provider unavailable")
    monkeypatch.setattr(market_data.yf, "Search", fail)
    with pytest.raises(HTTPException) as caught:
        search_stocks("Ciena")
    assert caught.value.status_code == 503
    assert market_data._search_cache.get("ciena") is None


def test_logo_is_cached_and_only_uses_fixed_provider(monkeypatch):
    market_data._logo_cache.clear()
    calls = []
    def fetch(url, **kwargs):
        calls.append(url)
        return SimpleNamespace(status_code=200, headers={"content-type": "image/png"}, content=b"png")
    monkeypatch.setattr(market_data.requests, "get", fetch)
    assert market_data.fetch_logo("CIEN") == (b"png", "image/png")
    assert market_data.fetch_logo("CIEN") == (b"png", "image/png")
    assert len(calls) == 1
    assert calls[0].startswith("https://www.google.com/s2/favicons?")
    assert "ciena.com" in calls[0]


def test_logo_rejects_non_image_response(monkeypatch):
    market_data._logo_cache.clear()
    monkeypatch.setattr(market_data.requests, "get", lambda *args, **kwargs: SimpleNamespace(status_code=200, headers={"content-type": "text/html"}, content=b"html"))
    with pytest.raises(LookupError):
        market_data.fetch_logo("CIEN")


def test_symbol_validation_supports_exchange_suffixes():
    assert normalize_symbol(" cie1.de ") == "CIE1.DE"
    with pytest.raises(HTTPException):
        normalize_symbol("../../private")
