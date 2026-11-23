"""Thesis tripwires, checked after every data refresh. Mirrors web/src/lib/tripwires.ts (keep the two in step).

Tripwires live in instruments.extra.tripwires as [{id, metric, op, value, note}]; values for % metrics are decimals.
"""
from __future__ import annotations

import datetime as dt
import math

LABELS = {
    "revenueGrowth": ("Revenue growth", "pct"),
    "operatingMargin": ("Operating margin", "pct"),
    "netMargin": ("Net margin", "pct"),
    "fcfMargin": ("FCF margin", "pct"),
    "roe": ("ROE", "pct"),
    "pe": ("P/E", "x"),
    "price": ("Price", "money"),
    "priceToDcf": ("Price vs DCF value", "pct"),
    "drawdown": ("Fall from 52-week high", "pct"),
}


def _f(x) -> float | None:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) else None


def _ratio(a, b) -> float | None:
    a, b = _f(a), _f(b)
    return a / b if a is not None and b else None


def metric_value(metric: str, doc: dict | None, dcf: float | None) -> float | None:
    if not doc:
        return None
    f = doc.get("fundamentals") or {}
    price = _f(doc.get("price"))
    if metric == "revenueGrowth":
        return _f(f.get("revenueGrowthYoy"))
    if metric == "operatingMargin":
        v = _ratio(f.get("ebitTtm"), f.get("revenueTtm"))
        return v if v is not None else _f(f.get("operatingMargin"))
    if metric == "netMargin":
        return _ratio(f.get("netIncomeTtm"), f.get("revenueTtm"))
    if metric == "fcfMargin":
        return _ratio(f.get("fcfTtm"), f.get("revenueTtm"))
    if metric == "roe":
        v = _f(f.get("roe"))
        return v if v is not None else _ratio(f.get("netIncomeTtm"), f.get("bookEquity"))
    if metric == "pe":
        return _f((doc.get("multiples") or {}).get("pe"))
    if metric == "price":
        return price
    if metric == "priceToDcf":
        return price / dcf if price is not None and _f(dcf) and dcf > 0 else None
    if metric == "drawdown":
        hi = _f(doc.get("fiftyTwoWeekHigh"))
        if hi is None:
            closes = [h[1] for h in (doc.get("history") or [])[-52:]]
            hi = max(closes) if closes else None
        return price / hi - 1 if price is not None and hi else None
    return None


def fmt(metric: str, v: float | None) -> str:
    if v is None:
        return "–"
    kind = LABELS.get(metric, ("", "x"))[1]
    return f"{v * 100:.1f}%" if kind == "pct" else f"{v:.1f}x" if kind == "x" else f"{v:.2f}"


def tripwire_alerts(instruments: list[dict], docs: dict[str, dict], today: dt.date) -> list[dict]:
    """One alert per crossed tripwire, at most once per ISO week while it stays crossed."""
    year, week, _ = today.isocalendar()
    out = []
    for ins in instruments:
        extra = ins.get("extra") or {}
        wires = extra.get("tripwires") or []
        sym = ins.get("symbol")
        for w in wires:
            m, op, thr = w.get("metric"), w.get("op"), _f(w.get("value"))
            if m not in LABELS or op not in ("<", ">") or thr is None:
                continue
            v = metric_value(m, docs.get(sym), _f(extra.get("dcfValue")))
            if v is None or not (v < thr if op == "<" else v > thr):
                continue
            label = LABELS[m][0]
            note = f" ({w['note']})" if w.get("note") else ""
            out.append({
                "symbol": sym,
                "kind": "tripwire",
                "message": f"{sym} tripwire: {label} {'below' if op == '<' else 'above'} {fmt(m, thr)}, now {fmt(m, v)}{note}",
                "dedupe_key": f"trip:{sym}:{w.get('id')}:{year}-W{week:02d}",
            })
    return out
