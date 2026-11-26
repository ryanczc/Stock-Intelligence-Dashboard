// Portfolio risk: exposures, correlations, betas and simple stress tests from free weekly price history.
import type { Holding } from "./portfolio";
import type { Benchmarks, MarketData } from "./types";

type Series = [string, number][];

/** Weekly returns clipped at +/-35% so one-off spikes (e.g. a microcap before a pivot) don't swamp betas and volatility. */
export const CLIP = 0.35;
/** Beta cap used in stress tests: regression betas above this are usually noise from a short or unusual history. */
export const BETA_CAP = 3;

/** Weekly returns keyed by week (Monday), clipped at +/-CLIP. */
export function returns(series: Series | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!series) return out;
  for (let i = 1; i < series.length; i++) {
    const [, p0] = series[i - 1];
    const [d, p1] = series[i];
    if (p0 > 0 && p1 > 0) out.set(weekKey(d), Math.max(-CLIP, Math.min(CLIP, p1 / p0 - 1)));
  }
  return out;
}

/** Align different weekly calendars (Friday close for stocks, Sunday/Monday for crypto) on ISO week. */
function weekKey(d: string): string {
  const dt = new Date(d + "T00:00:00Z");
  const day = (dt.getUTCDay() + 6) % 7; // Monday = 0
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}

function paired(a: Map<string, number>, b: Map<string, number>): [number[], number[]] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w != null) {
      xs.push(v);
      ys.push(w);
    }
  }
  return [xs, ys];
}

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;

export const MIN_WEEKS = 20;

export function correlation(a: Map<string, number>, b: Map<string, number>): number | null {
  const [x, y] = paired(a, b);
  if (x.length < MIN_WEEKS) return null;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Regression beta of `asset` on `bench`. */
export function beta(asset: Map<string, number>, bench: Map<string, number>): number | null {
  const [x, y] = paired(bench, asset);
  if (x.length < MIN_WEEKS) return null;
  const mx = mean(x);
  const my = mean(y);
  let cov = 0;
  let v = 0;
  for (let i = 0; i < x.length; i++) {
    cov += (x[i] - mx) * (y[i] - my);
    v += (x[i] - mx) ** 2;
  }
  return v > 0 ? cov / v : null;
}

export function annualVol(r: Map<string, number>): number | null {
  const x = [...r.values()];
  if (x.length < MIN_WEEKS) return null;
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1)) * Math.sqrt(52);
}

export interface Factor {
  key: "NDX" | "BTC";
  label: string;
  series?: Series;
}

/** Benchmarks from the data job; falls back to a tracked BTC-USD for bitcoin. */
export function factors(bench: Benchmarks, market: Record<string, MarketData>): Factor[] {
  return [
    { key: "NDX", label: "Nasdaq 100", series: bench.NDX ?? market["QQQ"]?.history },
    { key: "BTC", label: "Bitcoin", series: bench.BTC ?? market["BTC-USD"]?.history },
  ];
}

export interface HoldingRisk {
  symbol: string;
  weight: number;
  valueSgd: number;
  assetClass: string;
  sector: string;
  country: string;
  currency: string;
  vol: number | null;
  betaNdx: number;
  betaNdxSource: string;
  betaBtc: number;
  betaBtcSource: string;
}

const isCash = (h: Holding) => h.assetClass === "cash" || h.assetClass === "bond";

export function holdingRisks(holdings: Holding[], market: Record<string, MarketData>, bench: Benchmarks): HoldingRisk[] {
  const open = holdings.filter((h) => h.qty > 0 && h.valueSgd > 0);
  const total = open.reduce((s, h) => s + h.valueSgd, 0) || 1;
  const [ndx, btc] = factors(bench, market).map((f) => returns(f.series));
  return open.map((h) => {
    const md = market[h.symbol];
    const r = returns(md?.history);
    const crypto = h.assetClass === "crypto";
    let betaNdx = 0;
    let betaNdxSource = "cash: no market risk";
    let betaBtc = 0;
    let betaBtcSource = "cash: no market risk";
    if (!isCash(h)) {
      const bn = ndx.size ? beta(r, ndx) : null;
      if (bn != null) [betaNdx, betaNdxSource] = [bn, "2y weekly regression vs Nasdaq 100"];
      else if (md?.beta != null) [betaNdx, betaNdxSource] = [md.beta, "Yahoo beta vs S&P 500"];
      else [betaNdx, betaNdxSource] = [1, "assumed (not enough history)"];
      if (Math.abs(betaNdx) > BETA_CAP) [betaNdx, betaNdxSource] = [Math.sign(betaNdx) * BETA_CAP, `${betaNdxSource}, capped at ${BETA_CAP}`];
      const bb = btc.size ? beta(r, btc) : null;
      if (h.symbol === "BTC-USD") [betaBtc, betaBtcSource] = [1, "bitcoin itself"];
      else if (bb != null) [betaBtc, betaBtcSource] = [bb, "2y weekly regression vs bitcoin"];
      else [betaBtc, betaBtcSource] = [crypto ? 1.2 : 0, "assumed (not enough history)"];
      if (Math.abs(betaBtc) > BETA_CAP) [betaBtc, betaBtcSource] = [Math.sign(betaBtc) * BETA_CAP, `${betaBtcSource}, capped at ${BETA_CAP}`];
    }
    return {
      symbol: h.symbol,
      weight: h.valueSgd / total,
      valueSgd: h.valueSgd,
      assetClass: h.assetClass,
      sector: crypto ? "Crypto" : isCash(h) ? "Cash & bonds" : md?.sector ?? (h.assetClass === "etf" ? "ETF" : "Unknown"),
      country: crypto ? "Crypto (global)" : isCash(h) ? "Cash & bonds" : md?.country ?? "Unknown",
      currency: h.currency,
      vol: isCash(h) ? 0 : annualVol(r),
      betaNdx,
      betaNdxSource,
      betaBtc,
      betaBtcSource,
    };
  });
}

export function exposureBy(rows: HoldingRisk[], key: (r: HoldingRisk) => string) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.valueSgd);
  const tot = [...m.values()].reduce((a, b) => a + b, 0) || 1;
  return [...m.entries()].map(([k, v]) => ({ key: k, valueSgd: v, pct: v / tot })).sort((a, b) => b.valueSgd - a.valueSgd);
}

export interface Scenario {
  id: string;
  label: string;
  ndx?: number;
  btc?: number;
  usdSgd?: number; // change in SGD value of 1 USD, e.g. -0.10
}

export const SCENARIOS: Scenario[] = [
  { id: "ndx", label: "Nasdaq -20%", ndx: -0.2 },
  { id: "btc", label: "Bitcoin -40%", btc: -0.4 },
  { id: "usd", label: "USD/SGD -10% (US dollar weakens)", usdSgd: -0.1 },
  { id: "riskoff", label: "Risk-off: Nasdaq -20%, Bitcoin -40%, USD/SGD -5%", ndx: -0.2, btc: -0.4, usdSgd: -0.05 },
];

// Currencies whose SGD value follows the US dollar (HKD is pegged).
const USD_LINKED = new Set(["USD", "HKD"]);

/**
 * Estimated SGD loss per holding. Each holding takes the larger of its Nasdaq- and bitcoin-driven moves
 * (not the sum, which would double-count stocks like MSTR that move with both), then the currency move.
 */
export function stress(rows: HoldingRisk[], s: Scenario) {
  const lines = rows.map((r) => {
    const viaNdx = s.ndx ? r.betaNdx * s.ndx : 0;
    const viaBtc = s.btc ? r.betaBtc * s.btc : 0;
    const local = Math.max(-1, Math.abs(viaNdx) >= Math.abs(viaBtc) ? viaNdx : viaBtc);
    const fx = s.usdSgd && USD_LINKED.has(r.currency) ? s.usdSgd : 0;
    const total = (1 + local) * (1 + fx) - 1;
    return { symbol: r.symbol, local, fx, total, pnlSgd: r.valueSgd * total };
  });
  const pnl = lines.reduce((a, l) => a + l.pnlSgd, 0);
  const value = rows.reduce((a, r) => a + r.valueSgd, 0) || 1;
  return { lines: lines.sort((a, b) => a.pnlSgd - b.pnlSgd), pnlSgd: pnl, pct: pnl / value };
}

export function correlationMatrix(symbols: string[], market: Record<string, MarketData>) {
  const rs = symbols.map((s) => returns(market[s]?.history));
  return symbols.map((_, i) => symbols.map((__, j) => (i === j ? 1 : correlation(rs[i], rs[j]))));
}
