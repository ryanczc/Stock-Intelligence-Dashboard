"""CoinGecko (free, no key) fallback for tokens Yahoo Finance doesn't list, e.g. PURR, KNTQ, SYRUP.

Symbols stay in the app as <TICKER>-USD. When several coins share a ticker, the one with the best
market-cap rank wins; pin a specific coin in config/crypto_ids.json ({"PURR-USD": "<coingecko id>"}).
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import time

import requests

API = "https://api.coingecko.com/api/v3"
UA = {"User-Agent": "personal-portfolio-dashboard", "Accept": "application/json"}
IDS_FILE = pathlib.Path(__file__).resolve().parent / "config" / "crypto_ids.json"


def _get(path: str, params: dict) -> dict | list:
    for attempt in range(4):
        time.sleep(3)  # keep well under the free tier's per-minute limit
        r = requests.get(API + path, params=params, headers=UA, timeout=30)
        if r.status_code == 429:  # free tier rate limit
            time.sleep(30 * (attempt + 1))
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("CoinGecko rate limit")


def pinned_ids() -> dict[str, str]:
    try:
        return {k: v for k, v in json.loads(IDS_FILE.read_text()).items() if not k.startswith("_")}
    except Exception:  # noqa: BLE001
        return {}


def resolve_id(ticker: str) -> str | None:
    hits = [c for c in _get("/search", {"query": ticker}).get("coins", []) if (c.get("symbol") or "").upper() == ticker.upper()]
    if not hits:
        return None
    hits.sort(key=lambda c: c.get("market_cap_rank") or 10**9)
    return hits[0]["id"]


def fetch_symbol(symbol: str) -> dict | None:
    ticker = symbol.upper().removesuffix("-USD")
    cid = pinned_ids().get(symbol.upper()) or resolve_id(ticker)
    if not cid:
        return None
    m = _get("/coins/markets", {"vs_currency": "usd", "ids": cid})
    if not m:
        return None
    m = m[0]
    price = m.get("current_price")
    ch = m.get("price_change_percentage_24h")
    doc = {
        "symbol": symbol.upper(),
        "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "gaps": [f"from CoinGecko (id: {cid}); Yahoo has no data for this token"],
        "name": m.get("name") or ticker,
        "currency": "USD",
        "reportingCurrency": "USD",
        "exchange": "CoinGecko",
        "assetClass": "crypto",
        "price": price,
        "prevClose": price / (1 + ch / 100) if price and ch is not None else None,
        "marketCap": m.get("market_cap"),
        "fiftyTwoWeekHigh": None,
        "fiftyTwoWeekLow": None,
        "crypto": {
            "coingeckoId": cid,
            "circulatingSupply": m.get("circulating_supply"),
            "volume24h": m.get("total_volume"),
            "allTimeHigh": m.get("ath"),
            "fullyDilutedValuation": m.get("fully_diluted_valuation"),
        },
        "events": [],
        "news": [],
    }
    try:
        time.sleep(2)
        chart = _get(f"/coins/{cid}/market_chart", {"vs_currency": "usd", "days": 365, "interval": "daily"})
        pts = chart.get("prices", [])[::7]
        doc["history"] = [[dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc).date().isoformat(), round(p, 8)] for t, p in pts]
        closes = [p for _, p in chart.get("prices", [])]
        if closes:
            doc["fiftyTwoWeekHigh"], doc["fiftyTwoWeekLow"] = max(closes), min(closes)
    except Exception as e:  # noqa: BLE001
        doc["gaps"].append(f"history: {e}")
    return doc
