// Thesis tripwires: per-stock thresholds on fundamentals and price, checked live here and after every data refresh
// by the pipeline (pipeline/tripwires.py mirrors metricValue; keep the two in step).
import type { Instrument, MarketData, TripMetric, Tripwire } from "./types";

export const TRIP_METRICS: Record<TripMetric, { label: string; kind: "pct" | "x" | "money"; help: string }> = {
  revenueGrowth: { label: "Revenue growth (year on year)", kind: "pct", help: "Latest year-on-year revenue growth from the data feed." },
  operatingMargin: { label: "Operating margin (TTM)", kind: "pct", help: "Operating income / revenue, trailing 12 months." },
  netMargin: { label: "Net margin (TTM)", kind: "pct", help: "Net income / revenue, trailing 12 months." },
  fcfMargin: { label: "Free cash flow margin (TTM)", kind: "pct", help: "Free cash flow / revenue, trailing 12 months." },
  roe: { label: "Return on equity", kind: "pct", help: "Net income / book equity." },
  pe: { label: "P/E (trailing)", kind: "x", help: "Price / trailing earnings per share." },
  price: { label: "Share price", kind: "money", help: "Last price in the trading currency." },
  priceToDcf: { label: "Price as % of DCF value", kind: "pct", help: "Price / your probability-weighted DCF value. 80% = trading 20% below it." },
  drawdown: { label: "Fall from 52-week high", kind: "pct", help: "Price / 52-week high - 1, e.g. -25%." },
};

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const ratio = (a: unknown, b: unknown) => (fin(a) && fin(b) && b !== 0 ? a / b : null);

/** Current value of a tripwire metric. `dcf` is the live DCF value (web) or the last value saved from the web (pipeline). */
export function metricValue(m: TripMetric, md: MarketData | undefined, dcf: number | null | undefined): number | null {
  if (!md) return null;
  const f = md.fundamentals ?? {};
  switch (m) {
    case "revenueGrowth":
      return fin(f.revenueGrowthYoy) ? f.revenueGrowthYoy : null;
    case "operatingMargin":
      return ratio(f.ebitTtm, f.revenueTtm) ?? (fin(f.operatingMargin) ? f.operatingMargin : null);
    case "netMargin":
      return ratio(f.netIncomeTtm, f.revenueTtm);
    case "fcfMargin":
      return ratio(f.fcfTtm, f.revenueTtm);
    case "roe":
      return fin(f.roe) ? f.roe : ratio(f.netIncomeTtm, f.bookEquity);
    case "pe":
      return fin(md.multiples?.pe) ? md.multiples!.pe! : null;
    case "price":
      return fin(md.price) ? md.price : null;
    case "priceToDcf":
      return fin(dcf) && dcf > 0 ? ratio(md.price, dcf) : null;
    case "drawdown": {
      const hi = md.fiftyTwoWeekHigh ?? Math.max(...(md.history ?? []).slice(-52).map((h) => h[1]));
      return fin(md.price) && fin(hi) && hi > 0 ? md.price / hi - 1 : null;
    }
  }
}

export interface TripStatus {
  symbol: string;
  wire: Tripwire;
  value: number | null;
  breached: boolean;
}

export function checkTripwire(symbol: string, w: Tripwire, md: MarketData | undefined, dcf: number | null | undefined): TripStatus {
  const value = metricValue(w.metric, md, dcf);
  const breached = value != null && (w.op === "<" ? value < w.value : value > w.value);
  return { symbol, wire: w, value, breached };
}

export const tripwiresOf = (inst: Instrument | undefined): Tripwire[] => ((inst?.extra?.tripwires as Tripwire[] | undefined) ?? []).filter((w) => w && w.metric);

export function formatMetric(m: TripMetric, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const k = TRIP_METRICS[m].kind;
  if (k === "pct") return `${(v * 100).toFixed(1)}%`;
  if (k === "x") return `${v.toFixed(1)}x`;
  return v.toFixed(2);
}

export function describe(w: Tripwire): string {
  return `${TRIP_METRICS[w.metric].label} ${w.op === "<" ? "below" : "above"} ${formatMetric(w.metric, w.value)}`;
}
