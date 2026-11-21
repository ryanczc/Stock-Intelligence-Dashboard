// Holdings from transactions: weighted average cost per platform, combined across platforms.
// All amounts tracked in the trading currency AND in SGD (using FX at the time of each trade).
import type { Instrument, MarketData, Transaction } from "./types";
import type { FxTable } from "./valuation/defaults";

export interface Position {
  platform: string;
  qty: number;
  cost: number; // remaining cost basis, trading currency (incl. buy fees)
  costSgd: number;
  realized: number;
  realizedSgd: number;
  dividends: number;
  dividendsSgd: number;
  fees: number;
}

export interface Holding extends Omit<Position, "platform"> {
  symbol: string;
  name: string;
  currency: string;
  assetClass: string;
  avgCost: number;
  price: number | null;
  priceIsManual: boolean;
  value: number; // trading currency
  valueSgd: number;
  unrealizedSgd: number;
  unrealizedPct: number | null;
  dayChangeSgd: number;
  dayChangePct: number | null;
  platforms: (Position & { avgCost: number; valueSgd: number })[];
}

const empty = (platform: string): Position => ({ platform, qty: 0, cost: 0, costSgd: 0, realized: 0, realizedSgd: 0, dividends: 0, dividendsSgd: 0, fees: 0 });

export function isCashSymbol(s: string) {
  return /^CASH[-:]/i.test(s);
}

/** Applies one transaction to a position (average-cost method). Exported for tests. */
export function apply(p: Position, t: Transaction, fxNow: number) {
  const fx = t.fx_to_sgd ?? fxNow; // until the data job back-fills the historical rate
  const fees = t.fees || 0;
  switch (t.type) {
    case "buy":
    case "deposit": {
      p.qty += t.quantity;
      p.cost += t.quantity * t.price + fees;
      p.costSgd += (t.quantity * t.price + fees) * fx;
      p.fees += fees;
      break;
    }
    case "sell":
    case "withdrawal": {
      const q = Math.min(t.quantity, p.qty);
      const avg = p.qty > 0 ? p.cost / p.qty : 0;
      const avgSgd = p.qty > 0 ? p.costSgd / p.qty : 0;
      const proceeds = q * t.price - fees;
      p.realized += proceeds - q * avg;
      p.realizedSgd += proceeds * fx - q * avgSgd;
      p.cost -= q * avg;
      p.costSgd -= q * avgSgd;
      p.qty -= q;
      p.fees += fees;
      if (p.qty < 1e-9) {
        p.qty = 0;
        p.cost = 0;
        p.costSgd = 0;
      }
      break;
    }
    case "dividend": {
      const amt = t.quantity * t.price - fees;
      p.dividends += amt;
      p.dividendsSgd += amt * fx;
      break;
    }
    case "fee": {
      const amt = t.quantity * t.price + fees;
      p.realized -= amt;
      p.realizedSgd -= amt * fx;
      p.fees += amt;
      break;
    }
  }
}

export function computeHoldings(
  txs: Transaction[],
  market: Record<string, MarketData>,
  fx: FxTable,
  instruments: Record<string, Instrument> = {},
): Holding[] {
  const sorted = [...txs].sort((a, b) => a.trade_date.localeCompare(b.trade_date) || (a.type === "sell" ? 1 : 0) - (b.type === "sell" ? 1 : 0));
  const bySym = new Map<string, Map<string, Position>>();
  const ccy = new Map<string, string>();
  for (const t of sorted) {
    const sym = t.symbol.toUpperCase();
    if (!bySym.has(sym)) bySym.set(sym, new Map());
    const plats = bySym.get(sym)!;
    if (!plats.has(t.platform)) plats.set(t.platform, empty(t.platform));
    ccy.set(sym, t.currency);
    apply(plats.get(t.platform)!, t, fx[t.currency] ?? 1);
  }
  const out: Holding[] = [];
  for (const [sym, plats] of bySym) {
    const md = market[sym];
    const inst = instruments[sym];
    const currency = md?.currency ?? inst?.currency ?? ccy.get(sym) ?? "USD";
    const fxNow = fx[currency] ?? 1;
    const cash = isCashSymbol(sym);
    const manual = inst?.manual_price ?? null;
    const price = cash ? 1 : md?.price ?? manual ?? null;
    const prev = cash ? 1 : md?.prevClose ?? null;
    const agg = empty("all");
    const platforms: Holding["platforms"] = [];
    for (const p of plats.values()) {
      for (const k of ["qty", "cost", "costSgd", "realized", "realizedSgd", "dividends", "dividendsSgd", "fees"] as const) agg[k] += p[k];
      if (p.qty > 0 || p.realized || p.dividends)
        platforms.push({ ...p, avgCost: p.qty > 0 ? p.cost / p.qty : 0, valueSgd: price != null ? p.qty * price * fxNow : 0 });
    }
    const value = price != null ? agg.qty * price : 0;
    const valueSgd = value * fxNow;
    const unrealizedSgd = price != null ? valueSgd - agg.costSgd : 0;
    out.push({
      ...agg,
      symbol: sym,
      name: md?.name ?? inst?.name ?? sym,
      currency,
      assetClass: cash ? "cash" : inst?.asset_class ?? md?.assetClass ?? "stock",
      avgCost: agg.qty > 0 ? agg.cost / agg.qty : 0,
      price,
      priceIsManual: !cash && md?.price == null && manual != null,
      value,
      valueSgd,
      unrealizedSgd,
      unrealizedPct: agg.costSgd > 0 && price != null ? unrealizedSgd / agg.costSgd : null,
      dayChangeSgd: price != null && prev ? agg.qty * (price - prev) * fxNow : 0,
      dayChangePct: price != null && prev ? price / prev - 1 : null,
      platforms: platforms.sort((a, b) => b.valueSgd - a.valueSgd),
    });
  }
  return out.sort((a, b) => b.valueSgd - a.valueSgd);
}

export function totals(hs: Holding[]) {
  const open = hs.filter((h) => h.qty > 0);
  const valueSgd = open.reduce((s, h) => s + h.valueSgd, 0);
  const costSgd = open.reduce((s, h) => s + h.costSgd, 0);
  const dayChangeSgd = open.reduce((s, h) => s + h.dayChangeSgd, 0);
  return {
    valueSgd,
    costSgd,
    unrealizedSgd: valueSgd - costSgd,
    realizedSgd: hs.reduce((s, h) => s + h.realizedSgd, 0),
    dividendsSgd: hs.reduce((s, h) => s + h.dividendsSgd, 0),
    dayChangeSgd,
    dayChangePct: valueSgd - dayChangeSgd > 0 ? dayChangeSgd / (valueSgd - dayChangeSgd) : null,
  };
}

export function allocation<T extends { qty: number; valueSgd: number }>(hs: T[], key: (h: T) => string) {
  const m = new Map<string, number>();
  for (const h of hs) if (h.qty > 0) m.set(key(h), (m.get(key(h)) ?? 0) + h.valueSgd);
  const tot = [...m.values()].reduce((a, b) => a + b, 0) || 1;
  return [...m.entries()].map(([k, v]) => ({ key: k, valueSgd: v, pct: v / tot })).sort((a, b) => b.valueSgd - a.valueSgd);
}
