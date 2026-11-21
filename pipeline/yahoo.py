"""Fetch prices, fundamentals, events and activity for one symbol from Yahoo Finance (free, via yfinance).

Everything here is defensive: Yahoo's coverage of SGX / HKEX names is patchy, so every section is
optional and failures are recorded in `gaps` rather than raised.
"""
from __future__ import annotations

import math
import datetime as dt
from typing import Any

import pandas as pd

# --- small helpers -------------------------------------------------------------------------------


def _num(v: Any) -> float | None:
    try:
        if v is None:
            return None
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def row(df: pd.DataFrame | None, *labels: str, col: int = 0) -> float | None:
    """First non-null value for any of `labels` in column `col` of a yfinance statement frame."""
    if df is None or getattr(df, "empty", True):
        return None
    for label in labels:
        if label in df.index:
            try:
                vals = df.loc[label]
                if isinstance(vals, pd.DataFrame):
                    vals = vals.iloc[0]
                if col < len(vals):
                    v = _num(vals.iloc[col])
                    if v is not None:
                        return v
            except Exception:  # noqa: BLE001
                continue
    return None


def series(df: pd.DataFrame | None, *labels: str, n: int = 5) -> list[dict]:
    """Annual history [{year, value}] oldest -> newest for the first label present."""
    if df is None or getattr(df, "empty", True):
        return []
    for label in labels:
        if label in df.index:
            out = []
            vals = df.loc[label]
            if isinstance(vals, pd.DataFrame):
                vals = vals.iloc[0]
            for c, v in vals.items():
                f = _num(v)
                if f is not None:
                    out.append({"year": pd.Timestamp(c).year, "value": f})
            out.sort(key=lambda x: x["year"])
            return out[-n:]
    return []


def _iso(d: Any) -> str | None:
    try:
        if d is None or (isinstance(d, float) and math.isnan(d)):
            return None
        return pd.Timestamp(d).date().isoformat()
    except Exception:  # noqa: BLE001
        return None


# --- asset classification -------------------------------------------------------------------------

BANK_WORDS = ("bank", "credit services", "capital markets", "financial conglomerates")
INSURER_WORDS = ("insurance",)


def classify(info: dict, symbol: str) -> str:
    qt = (info.get("quoteType") or "").upper()
    industry = (info.get("industry") or "").lower()
    name = (info.get("longName") or info.get("shortName") or "").lower()
    if qt == "CRYPTOCURRENCY" or symbol.endswith("-USD"):
        return "crypto"
    if qt in ("ETF", "MUTUALFUND"):
        return "etf"
    if industry.startswith("reit") or " reit" in name or "real estate investment trust" in name:
        return "reit"
    if any(w in industry for w in INSURER_WORDS):
        return "insurer"
    if industry.startswith("banks") or any(w == industry for w in BANK_WORDS):
        return "bank"
    return "stock"


# --- main fetch -----------------------------------------------------------------------------------


def fetch_symbol(symbol: str, yf_module=None) -> dict:
    """Return the market-data document for `symbol` (see web/src/lib/types.ts MarketData)."""
    import yfinance as yf  # imported lazily so tests can inject a fake module

    yf = yf_module or yf
    t = yf.Ticker(symbol)
    gaps: list[str] = []
    out: dict[str, Any] = {"symbol": symbol, "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "gaps": gaps}

    try:
        info = t.info or {}
    except Exception as e:  # noqa: BLE001
        info = {}
        gaps.append(f"info: {e}")

    # price history (weekly, 2y) also gives us price when info is thin
    hist = None
    try:
        hist = t.history(period="2y", interval="1wk", auto_adjust=False)
    except Exception as e:  # noqa: BLE001
        gaps.append(f"history: {e}")

    daily = None
    try:
        daily = t.history(period="7d", interval="1d", auto_adjust=False)
    except Exception as e:  # noqa: BLE001
        gaps.append(f"daily: {e}")

    price = _num(info.get("currentPrice")) or _num(info.get("regularMarketPrice"))
    prev = _num(info.get("regularMarketPreviousClose")) or _num(info.get("previousClose"))
    if daily is not None and not daily.empty:
        closes = daily["Close"].dropna()
        if len(closes):
            price = float(closes.iloc[-1])
        if len(closes) > 1:
            prev = float(closes.iloc[-2])

    asset_class = classify(info, symbol)
    out.update(
        {
            "name": info.get("longName") or info.get("shortName") or symbol,
            "currency": (info.get("currency") or "USD").upper(),
            "reportingCurrency": (info.get("financialCurrency") or info.get("currency") or "USD").upper(),
            "exchange": info.get("exchange"),
            "country": info.get("country"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "assetClass": asset_class,
            "price": price,
            "prevClose": prev,
            "marketCap": _num(info.get("marketCap")),
            "shares": _num(info.get("sharesOutstanding")) or _num(info.get("impliedSharesOutstanding")),
            "beta": _num(info.get("beta")),
            "dividendRate": _num(info.get("dividendRate")) or _num(info.get("trailingAnnualDividendRate")),
            "dividendYield": _num(info.get("dividendYield")),
            "fiftyTwoWeekHigh": _num(info.get("fiftyTwoWeekHigh")),
            "fiftyTwoWeekLow": _num(info.get("fiftyTwoWeekLow")),
            "multiples": {
                "pe": _num(info.get("trailingPE")),
                "forwardPe": _num(info.get("forwardPE")),
                "pb": _num(info.get("priceToBook")),
                "evEbitda": _num(info.get("enterpriseToEbitda")),
                "evRevenue": _num(info.get("enterpriseToRevenue")),
            },
            "analyst": {
                "targetMean": _num(info.get("targetMeanPrice")),
                "recommendation": info.get("recommendationKey"),
                "numAnalysts": _num(info.get("numberOfAnalystOpinions")),
            },
        }
    )
    if hist is not None and not hist.empty:
        out["history"] = [[_iso(i), round(float(c), 4)] for i, c in hist["Close"].dropna().items()]

    if asset_class in ("crypto", "etf"):
        if asset_class == "crypto":
            out["crypto"] = {
                "circulatingSupply": _num(info.get("circulatingSupply")),
                "volume24h": _num(info.get("volume24Hr")) or _num(info.get("regularMarketVolume")),
                "allTimeHigh": max((h[1] for h in out.get("history", [])), default=None),
            }
        out["events"] = []
        out["news"] = _news(t, gaps)
        return out

    out["fundamentals"] = _fundamentals(t, info, gaps)
    out["events"] = _events(t, info, gaps)
    out["dividends"] = _dividends(t, gaps)
    out["insiders"] = _insiders(t, gaps)
    out["institutions"] = _institutions(t, gaps)
    out["news"] = _news(t, gaps)
    if out["fundamentals"].get("revenueTtm") is None and asset_class not in ("bank", "insurer"):
        gaps.append("fundamentals: no revenue data from Yahoo; enter DCF inputs manually")
    return out


def _fundamentals(t, info: dict, gaps: list[str]) -> dict:
    f: dict[str, Any] = {}
    try:
        inc_a = t.income_stmt
        bal_a = t.balance_sheet
        cf_a = t.cashflow
    except Exception as e:  # noqa: BLE001
        gaps.append(f"statements: {e}")
        inc_a = bal_a = cf_a = None
    try:
        inc_t = t.ttm_income_stmt
    except Exception:  # noqa: BLE001
        inc_t = None
    try:
        cf_t = t.ttm_cashflow
    except Exception:  # noqa: BLE001
        cf_t = None
    try:
        bal_q = t.quarterly_balance_sheet
    except Exception:  # noqa: BLE001
        bal_q = None

    def ttm_or_annual(inc_ttm, inc_ann, *labels):
        v = row(inc_ttm, *labels)
        return v if v is not None else row(inc_ann, *labels)

    f["revenueHistory"] = series(inc_a, "Total Revenue", "Operating Revenue")
    f["netIncomeHistory"] = series(inc_a, "Net Income Common Stockholders", "Net Income")
    f["revenueTtm"] = ttm_or_annual(inc_t, inc_a, "Total Revenue", "Operating Revenue")
    f["ebitTtm"] = ttm_or_annual(inc_t, inc_a, "Operating Income", "EBIT")
    f["ebitdaTtm"] = ttm_or_annual(inc_t, inc_a, "EBITDA", "Normalized EBITDA")
    f["netIncomeTtm"] = ttm_or_annual(inc_t, inc_a, "Net Income Common Stockholders", "Net Income")
    f["interestExpenseTtm"] = ttm_or_annual(inc_t, inc_a, "Interest Expense", "Interest Expense Non Operating")
    pretax = ttm_or_annual(inc_t, inc_a, "Pretax Income")
    tax = ttm_or_annual(inc_t, inc_a, "Tax Provision")
    f["effectiveTaxRate"] = (tax / pretax) if pretax and tax is not None and pretax > 0 else _num(info.get("taxRate"))
    f["ocfTtm"] = ttm_or_annual(cf_t, cf_a, "Operating Cash Flow")
    capex = ttm_or_annual(cf_t, cf_a, "Capital Expenditure")
    f["capexTtm"] = abs(capex) if capex is not None else None
    f["daTtm"] = ttm_or_annual(cf_t, cf_a, "Depreciation And Amortization", "Depreciation Amortization Depletion")
    divs = ttm_or_annual(cf_t, cf_a, "Cash Dividends Paid", "Common Stock Dividend Paid")
    f["dividendsPaidTtm"] = abs(divs) if divs is not None else None
    if f["ocfTtm"] is not None and f["capexTtm"] is not None:
        f["fcfTtm"] = f["ocfTtm"] - f["capexTtm"]
    else:
        f["fcfTtm"] = _num(info.get("freeCashflow"))

    bal = bal_q if bal_q is not None and not getattr(bal_q, "empty", True) else bal_a
    f["totalDebt"] = row(bal, "Total Debt") or _num(info.get("totalDebt"))
    f["leaseLiabilities"] = row(bal, "Capital Lease Obligations", "Long Term Capital Lease Obligation")
    f["cash"] = row(bal, "Cash Cash Equivalents And Short Term Investments", "Cash And Cash Equivalents") or _num(info.get("totalCash"))
    f["bookEquity"] = row(bal, "Stockholders Equity", "Common Stock Equity")
    f["minorityInterest"] = row(bal, "Minority Interest")
    f["bookEquityHistory"] = series(bal_a, "Stockholders Equity", "Common Stock Equity")
    f["eps"] = _num(info.get("trailingEps"))
    f["bookValuePerShare"] = _num(info.get("bookValue"))
    f["roe"] = _num(info.get("returnOnEquity"))
    f["payoutRatio"] = _num(info.get("payoutRatio"))
    f["operatingMargin"] = _num(info.get("operatingMargins"))
    # REIT proxy: FFO ~ net income + D&A (Yahoo has no FFO line). Labelled as a proxy in the UI.
    if f["netIncomeTtm"] is not None and f["daTtm"] is not None:
        f["ffoTtm"] = f["netIncomeTtm"] + f["daTtm"]

    # analyst growth expectations (mostly US coverage)
    try:
        re_ = t.revenue_estimate
        if re_ is not None and not re_.empty:
            f["revenueGrowthNextYear"] = _num(re_.loc["+1y", "growth"]) if "+1y" in re_.index else None
            f["revenueGrowthThisYear"] = _num(re_.loc["0y", "growth"]) if "0y" in re_.index else None
    except Exception:  # noqa: BLE001
        pass
    try:
        ge = t.growth_estimates
        if ge is not None and not ge.empty:
            col = "stockTrend" if "stockTrend" in ge.columns else ge.columns[0]
            if "LTG" in ge.index:
                f["epsGrowthLongTerm"] = _num(ge.loc["LTG", col])
            elif "+5y" in ge.index:
                f["epsGrowthLongTerm"] = _num(ge.loc["+5y", col])
    except Exception:  # noqa: BLE001
        pass
    f["revenueGrowthYoy"] = _num(info.get("revenueGrowth"))
    return f


def _events(t, info: dict, gaps: list[str]) -> list[dict]:
    ev: list[dict] = []
    try:
        cal = t.calendar or {}
        ed = cal.get("Earnings Date")
        if ed:
            dates = ed if isinstance(ed, (list, tuple)) else [ed]
            ev.append({"date": _iso(dates[0]), "type": "earnings", "title": "Earnings release"})
        if cal.get("Ex-Dividend Date"):
            ev.append({"date": _iso(cal["Ex-Dividend Date"]), "type": "dividend", "title": "Ex-dividend date"})
        if cal.get("Dividend Date"):
            ev.append({"date": _iso(cal["Dividend Date"]), "type": "dividend", "title": "Dividend payment"})
    except Exception as e:  # noqa: BLE001
        gaps.append(f"calendar: {e}")
    try:
        sp = t.splits
        if sp is not None and len(sp):
            for d, r in sp.tail(3).items():
                ev.append({"date": _iso(d), "type": "split", "title": f"Stock split {r:g}:1"})
    except Exception:  # noqa: BLE001
        pass
    return [e for e in ev if e.get("date")]


def _dividends(t, gaps: list[str]) -> list[dict]:
    try:
        d = t.dividends
        if d is None or not len(d):
            return []
        return [{"date": _iso(i), "amount": round(float(v), 6)} for i, v in d.tail(12).items()]
    except Exception as e:  # noqa: BLE001
        gaps.append(f"dividends: {e}")
        return []


def _insiders(t, gaps: list[str]) -> list[dict]:
    try:
        df = t.insider_transactions
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.head(25).iterrows():
            out.append(
                {
                    "date": _iso(r.get("Start Date")),
                    "insider": r.get("Insider"),
                    "position": r.get("Position"),
                    "text": r.get("Text") or r.get("Transaction"),
                    "shares": _num(r.get("Shares")),
                    "value": _num(r.get("Value")),
                }
            )
        return out
    except Exception as e:  # noqa: BLE001
        gaps.append(f"insiders: {e}")
        return []


def _institutions(t, gaps: list[str]) -> list[dict]:
    try:
        df = t.institutional_holders
        if df is None or df.empty:
            return []
        out = []
        for _, r in df.head(10).iterrows():
            out.append(
                {
                    "date": _iso(r.get("Date Reported")),
                    "holder": r.get("Holder"),
                    "pctHeld": _num(r.get("pctHeld")),
                    "shares": _num(r.get("Shares")),
                    "value": _num(r.get("Value")),
                    "pctChange": _num(r.get("pctChange")),
                }
            )
        return out
    except Exception as e:  # noqa: BLE001
        gaps.append(f"institutions: {e}")
        return []


def _news(t, gaps: list[str]) -> list[dict]:
    try:
        items = t.news or []
    except Exception as e:  # noqa: BLE001
        gaps.append(f"news: {e}")
        return []
    out = []
    for n in items[:8]:
        c = n.get("content", n)
        url = (c.get("canonicalUrl") or {}).get("url") if isinstance(c.get("canonicalUrl"), dict) else c.get("link")
        out.append(
            {
                "title": c.get("title"),
                "publisher": (c.get("provider") or {}).get("displayName") if isinstance(c.get("provider"), dict) else c.get("publisher"),
                "url": url,
                "time": c.get("pubDate") or (dt.datetime.fromtimestamp(c["providerPublishTime"], dt.timezone.utc).isoformat() if c.get("providerPublishTime") else None),
            }
        )
    return [n for n in out if n["title"]]


def fetch_fx(currencies: set[str], yf_module=None) -> dict[str, float]:
    """Rates as SGD per 1 unit of currency, e.g. {"USD": 1.34}."""
    import yfinance as yf

    yf = yf_module or yf
    rates = {"SGD": 1.0}
    for c in sorted(currencies - {"SGD"}):
        try:
            h = yf.Ticker(f"{c}SGD=X").history(period="5d")
            if h is not None and not h.empty:
                rates[c] = float(h["Close"].dropna().iloc[-1])
        except Exception:  # noqa: BLE001
            pass
    return rates


def fx_on_date(currency: str, date: str, yf_module=None) -> float | None:
    """SGD per unit of `currency` on (or just before) `date`. Used to back-fill trade FX."""
    if currency == "SGD":
        return 1.0
    import yfinance as yf

    yf = yf_module or yf
    d = pd.Timestamp(date)
    try:
        h = yf.Ticker(f"{currency}SGD=X").history(start=(d - pd.Timedelta(days=7)).date().isoformat(), end=(d + pd.Timedelta(days=1)).date().isoformat())
        if h is not None and not h.empty:
            return float(h["Close"].dropna().iloc[-1])
    except Exception:  # noqa: BLE001
        return None
    return None


def risk_free_us(yf_module=None) -> float | None:
    """US 10y Treasury yield from ^TNX (quoted in percent)."""
    import yfinance as yf

    yf = yf_module or yf
    try:
        h = yf.Ticker("^TNX").history(period="5d")
        return float(h["Close"].dropna().iloc[-1]) / 100.0
    except Exception:  # noqa: BLE001
        return None
