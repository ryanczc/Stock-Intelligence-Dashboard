"""Twice-daily data job.

  python -m pipeline.run                         # normal run against Supabase (GitHub Actions)
  python -m pipeline.run --dry-run --symbols AAPL,D05.SI --out /tmp/market.json   # no Supabase, print summary
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys
import time

from . import alerts as alerts_mod
from . import damodaran, yahoo

ROOT = pathlib.Path(__file__).resolve().parent
REFERENCE_MAX_AGE_DAYS = 7


def load_config_events() -> list[dict]:
    out = []
    for f in ("macro_events.json", "crypto_events.json"):
        try:
            out += json.loads((ROOT / "config" / f).read_text())["events"]
        except Exception:  # noqa: BLE001
            pass
    return out


def summarize(doc: dict) -> str:
    f = doc.get("fundamentals") or {}
    keys = ["revenueTtm", "ebitTtm", "netIncomeTtm", "fcfTtm", "totalDebt", "cash", "bookEquity", "revenueGrowthNextYear"]
    have = [k for k in keys if f.get(k) is not None]
    return (
        f"{doc['symbol']:<10} {doc.get('assetClass'):<7} {doc.get('currency')}/{doc.get('reportingCurrency')} price={doc.get('price')} "
        f"ind={doc.get('industry')!r} fundamentals={len(have)}/{len(keys)} events={len(doc.get('events') or [])} "
        f"insiders={len(doc.get('insiders') or [])} funds={len(doc.get('institutions') or [])} news={len(doc.get('news') or [])} gaps={doc.get('gaps')}"
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="don't touch Supabase or Telegram")
    ap.add_argument("--symbols", help="comma-separated symbols (default: everything tracked in Supabase)")
    ap.add_argument("--out", help="write market data JSON here")
    ap.add_argument("--reference", action="store_true", help="force refresh of Damodaran reference data")
    ap.add_argument("--print-json", action="store_true", help="print full JSON (for CI debugging)")
    args = ap.parse_args(argv)

    store = None
    if not args.dry_run:
        from .store import Store

        store = Store()

    today = dt.date.today()
    symbols = [s.strip() for s in args.symbols.split(",")] if args.symbols else (store.tracked_symbols() if store else [])
    print(f"refreshing {len(symbols)} symbols: {', '.join(symbols)}")

    docs, failures = [], []
    for s in symbols:
        try:
            doc = yahoo.fetch_symbol(s)
            docs.append(doc)
            print(summarize(doc))
        except Exception as e:  # noqa: BLE001
            failures.append(s)
            print(f"{s}: FAILED {e}", file=sys.stderr)
        time.sleep(0.5)  # be polite to Yahoo

    currencies = {d.get("currency") for d in docs} | {d.get("reportingCurrency") for d in docs} | {"USD", "HKD", "CNY", "EUR"}
    fx = yahoo.fetch_fx({c for c in currencies if c})
    print(f"fx (SGD per unit): {fx}")

    ref = None
    need_ref = args.reference or args.dry_run
    if store and not need_ref:
        cur = store.reference("damodaran")
        if not cur:
            need_ref = True
        else:
            age = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(cur["updated_at"].replace("Z", "+00:00"))
            need_ref = age.days >= REFERENCE_MAX_AGE_DAYS
    if need_ref:
        ref = damodaran.build_reference(yahoo.risk_free_us())
        sample = {k: ref["industries"].get("US", {}).get(k) for k in ("Software (System & Application)", "Bank (Money Center)", "R.E.I.T.")}
        print(f"reference: erp={ref.get('erp')} rf={ref.get('riskFree')} us_industries={len(ref['industries'].get('US', {}))} "
              f"global_industries={len(ref['industries'].get('Global', {}))} sample={json.dumps(sample)}")
        print(f"reference countries sample: { {k: ref['countries'].get(k) for k in ('United States', 'Singapore', 'Hong Kong', 'China')} }")

    events = load_config_events()
    new_alerts: list[dict] = []
    for d in docs:
        new_alerts += alerts_mod.make_alerts(d, today)
    if store:
        events += store.custom_events()
    new_alerts += alerts_mod.macro_alerts(events, today)

    if args.out:
        pathlib.Path(args.out).write_text(json.dumps({"market": docs, "fx": fx, "reference": ref, "alerts": new_alerts}, default=str))
    if args.print_json:
        print("JSON_START" + json.dumps({"market": docs, "fx": fx, "reference": ref}, default=str) + "JSON_END")

    if store:
        store.save_market_data(docs)
        store.save_reference("fx", {"rates": fx, "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat()})
        store.save_reference("macro", {"events": load_config_events()})
        if ref and (ref.get("industries", {}).get("US") or ref.get("countries")):
            store.save_reference("damodaran", ref)
        for tx in store.transactions_missing_fx():
            rate = yahoo.fx_on_date(tx["currency"], tx["trade_date"])
            if rate:
                store.set_fx(tx["id"], rate)
        inserted = store.insert_alerts(new_alerts)
        print(f"alerts: {len(new_alerts)} candidates, {len(inserted)} new")
        alerts_mod.send_telegram(inserted)
    else:
        print(f"alerts (dry run): {[a['message'] for a in new_alerts]}")

    print(f"done: {len(docs)} ok, {len(failures)} failed {failures}")
    return 0 if len(failures) < max(1, len(symbols)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
