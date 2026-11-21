"""Turn fresh market data into alerts (dashboard feed + Telegram). Pure functions, easy to test."""
from __future__ import annotations

import datetime as dt
import os

import requests

PRICE_MOVE = 0.05  # 5% daily move
EVENT_DAYS = 7  # remind this many days before an event
MACRO_DAYS = 2
INSIDER_MIN_VALUE = 1_000_000  # USD (Yahoo reports in trading currency)
INSIDER_LOOKBACK = 14
FUND_CHANGE = 0.20  # 13F position change of 20%+


def _days(a: str, today: dt.date) -> int | None:
    try:
        return (dt.date.fromisoformat(a[:10]) - today).days
    except (TypeError, ValueError):
        return None


def make_alerts(doc: dict, today: dt.date) -> list[dict]:
    sym = doc["symbol"]
    out: list[dict] = []
    price, prev = doc.get("price"), doc.get("prevClose")
    if price and prev:
        move = price / prev - 1
        if abs(move) >= PRICE_MOVE:
            out.append(
                {
                    "symbol": sym,
                    "kind": "price_move",
                    "message": f"{sym} {'up' if move > 0 else 'down'} {abs(move):.1%} to {price:,.2f} {doc.get('currency', '')}",
                    "dedupe_key": f"move:{sym}:{today.isoformat()}",
                }
            )
    for e in doc.get("events", []) or []:
        d = _days(e.get("date"), today)
        if d is not None and 0 <= d <= EVENT_DAYS:
            out.append(
                {
                    "symbol": sym,
                    "kind": e.get("type", "event"),
                    "message": f"{sym}: {e.get('title')} on {e['date']} ({'today' if d == 0 else f'in {d} days'})",
                    "dedupe_key": f"event:{sym}:{e.get('type')}:{e['date']}",
                }
            )
    for t in doc.get("insiders", []) or []:
        d = _days(t.get("date"), today)
        if d is None or d < -INSIDER_LOOKBACK or not t.get("value") or t["value"] < INSIDER_MIN_VALUE:
            continue
        text = (t.get("text") or "").strip() or "transaction"
        out.append(
            {
                "symbol": sym,
                "kind": "insider",
                "message": f"{sym} insider: {t.get('insider')} ({t.get('position') or 'insider'}) {text[:80]}, value {t['value']:,.0f}",
                "dedupe_key": f"insider:{sym}:{t.get('insider')}:{t.get('date')}:{t.get('shares')}",
            }
        )
    for h in doc.get("institutions", []) or []:
        ch = h.get("pctChange")
        if ch is not None and abs(ch) >= FUND_CHANGE:
            out.append(
                {
                    "symbol": sym,
                    "kind": "fund",
                    "message": f"{sym} 13F: {h.get('holder')} {'added' if ch > 0 else 'cut'} {abs(ch):.0%} (reported {h.get('date')})",
                    "dedupe_key": f"fund:{sym}:{h.get('holder')}:{h.get('date')}",
                }
            )
    return out


def macro_alerts(events: list[dict], today: dt.date) -> list[dict]:
    out = []
    for e in events:
        d = _days(e.get("date"), today)
        if d is not None and 0 <= d <= MACRO_DAYS:
            out.append(
                {
                    "symbol": e.get("symbol"),
                    "kind": e.get("type", "macro"),
                    "message": f"{e.get('title')} on {e['date']}" + (f" ({e['symbol']})" if e.get("symbol") else ""),
                    "dedupe_key": f"macro:{e.get('symbol') or ''}:{e.get('title')}:{e['date']}",
                }
            )
    return out


def send_telegram(alerts: list[dict], log=print) -> None:
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat or not alerts:
        return
    icons = {"price_move": "📈", "earnings": "📅", "dividend": "💵", "insider": "🕵️", "fund": "🏦", "macro": "🌐", "split": "✂️"}
    lines = [f"{icons.get(a['kind'], '•')} {a['message']}" for a in alerts]
    for i in range(0, len(lines), 30):
        try:
            requests.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat, "text": "\n".join(lines[i : i + 30]), "disable_web_page_preview": True},
                timeout=20,
            )
        except requests.RequestException as e:
            log(f"telegram failed: {e}")
