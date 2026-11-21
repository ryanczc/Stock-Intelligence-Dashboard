// Build default model inputs for a symbol from market data + Damodaran reference data.
// Every default carries a short "source" note so the assumptions panel can explain where it came from.
import type { MarketData, ReferenceData, AssetClass } from "../types";
import { costOfCapital, syntheticRating } from "./costOfCapital";
import type { Inputs, ModelId } from "./models";
import { FALLBACK_REFERENCE, MARGINAL_TAX, RISK_FREE_DEFAULTS, mapIndustry, pickIndustry } from "./reference";

export interface Defaults {
  model: ModelId;
  inputs: Inputs;
  sources: Record<string, string>;
  context: {
    industry: string;
    industrySource: string;
    reportingCurrency: string;
    tradingCurrency: string;
    riskFree: number;
    erp: number;
    crp: number;
    country: string;
    rating?: string;
    leveredBeta?: number;
    costOfEquity?: number;
    industryMultiples: { pe?: number; evEbitda?: number; pb?: number };
    industryMargin?: number;
  };
  missing: string[];
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const n = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

export function modelFor(assetClass: AssetClass | undefined): ModelId | null {
  if (assetClass === "bank" || assetClass === "insurer") return "excessReturn";
  if (assetClass === "reit") return "reitDdm";
  if (assetClass === "stock" || assetClass === undefined) return "fcff";
  return null; // etf, crypto, cash, bond: no intrinsic model
}

/** SGD per unit for each currency. */
export type FxTable = Record<string, number>;

export function fxRate(fx: FxTable, from: string, to: string): number {
  if (from === to) return 1;
  const a = fx[from];
  const b = fx[to];
  return n(a) && n(b) && b > 0 ? a / b : NaN;
}

export function cagrFromHistory(h: { year: number; value: number }[] | undefined, years = 3): number | null {
  if (!h || h.length < 2) return null;
  const pts = h.slice(-(years + 1));
  const first = pts[0];
  const last = pts[pts.length - 1];
  const span = last.year - first.year;
  if (span <= 0 || first.value <= 0 || last.value <= 0) return null;
  return Math.pow(last.value / first.value, 1 / span) - 1;
}

export function dividendGrowth(divs: { date: string; amount: number }[] | undefined): number | null {
  if (!divs?.length) return null;
  const thisYear = new Date().getFullYear();
  const byYear = new Map<number, number>();
  for (const d of divs) {
    const y = Number(d.date.slice(0, 4));
    if (y < thisYear) byYear.set(y, (byYear.get(y) ?? 0) + d.amount);
  }
  const h = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, value]) => ({ year, value }));
  return h.length >= 3 ? cagrFromHistory(h, h.length - 1) : null;
}

/** Sum of dividends paid in the last 365 days (per share, trading currency). */
export function trailingDividends(divs: { date: string; amount: number }[] | undefined, asOf = new Date()): number | null {
  if (!divs?.length) return null;
  const cutoff = new Date(asOf.getTime() - 365 * 864e5).toISOString().slice(0, 10);
  const recent = divs.filter((d) => d.date > cutoff);
  return recent.length ? recent.reduce((s, d) => s + d.amount, 0) : null;
}

export function buildDefaults(md: MarketData, refIn: ReferenceData | null | undefined, fx: FxTable, opts: { industry?: string; model?: ModelId } = {}): Defaults | null {
  const ref: ReferenceData = { ...FALLBACK_REFERENCE, ...(refIn || {}) };
  const model = opts.model ?? modelFor(md.assetClass);
  if (!model) return null;
  const f = md.fundamentals ?? {};
  const sources: Record<string, string> = {};
  const missing: string[] = [];
  const trading = md.currency ?? "USD";
  const reporting = md.reportingCurrency ?? trading;
  const country = md.country ?? "United States";
  const fxRT = fxRate(fx, reporting, trading);
  const fxRepToTrading = n(fxRT) ? fxRT : 1;
  if (!n(fxRT) && reporting !== trading) missing.push(`FX ${reporting}->${trading}`);

  const industry = opts.industry ?? mapIndustry(md.industry);
  const ind = pickIndustry(ref, industry, country);
  const rf = ref.riskFree?.[reporting] ?? RISK_FREE_DEFAULTS[reporting] ?? RISK_FREE_DEFAULTS.USD;
  const erp = ref.erp ?? FALLBACK_REFERENCE.erp!;
  const crp = ref.countries?.[country]?.crp ?? FALLBACK_REFERENCE.countries?.[country]?.crp ?? 0;
  const taxMarginal = MARGINAL_TAX[country] ?? 0.25;
  const refLabel = ref.updatedAt ? `Damodaran ${ref.updatedAt.slice(0, 10)}` : "built-in fallback";

  const ctx: Defaults["context"] = {
    industry: ind.name,
    industrySource: ind.region === "fallback" ? "built-in fallback" : `Damodaran ${ind.region}`,
    reportingCurrency: reporting,
    tradingCurrency: trading,
    riskFree: rf,
    erp,
    crp,
    country,
    industryMultiples: { pe: ind.values.pe, evEbitda: ind.values.evEbitda, pb: ind.values.pb },
    industryMargin: ind.values.operatingMargin,
  };
  const stableG = Math.min(rf, 0.04);
  const shares = md.shares ?? (md.marketCap && md.price ? md.marketCap / md.price : NaN);
  if (!n(shares)) missing.push("shares outstanding");
  const dps0Trading = trailingDividends(md.dividends) ?? md.dividendRate ?? 0;
  const dps0 = dps0Trading / fxRepToTrading;
  const yahooBeta = n(md.beta) ? clamp(md.beta, 0.5, 1.6) : null;

  if (model === "fcff") {
    const rev = f.revenueTtm;
    if (!n(rev)) missing.push("revenue");
    const margin = n(rev) && rev > 0 && n(f.ebitTtm) ? clamp(f.ebitTtm / rev, -0.5, 0.7) : ind.values.operatingMargin ?? 0.1;
    sources.currentMargin = n(f.ebitTtm) ? "TTM operating income / revenue" : "industry average";
    const hist = cagrFromHistory(f.revenueHistory);
    const analyst = f.revenueGrowthNextYear ?? f.revenueGrowthThisYear;
    let growth: number;
    if (n(analyst) && n(hist)) {
      growth = (analyst + hist) / 2;
      sources.growthHigh = `avg of analyst next-year (${(analyst * 100).toFixed(1)}%) and 3y history (${(hist * 100).toFixed(1)}%)`;
    } else if (n(analyst)) {
      growth = analyst;
      sources.growthHigh = "analyst next-year revenue growth";
    } else if (n(hist)) {
      growth = hist;
      sources.growthHigh = "3-year historical revenue CAGR";
    } else {
      growth = f.revenueGrowthYoy ?? 0.05;
      sources.growthHigh = n(f.revenueGrowthYoy) ? "last reported YoY growth" : "placeholder 5%, please set";
    }
    growth = clamp(growth, -0.05, 0.4);
    const target = margin > 0 ? margin : ind.values.operatingMargin ?? 0.1;
    sources.targetMargin = margin > 0 ? `current margin held (industry: ${ind.values.operatingMargin != null ? (ind.values.operatingMargin * 100).toFixed(1) + "%" : "n/a"})` : "industry average operating margin";
    const effTax = n(f.effectiveTaxRate) ? clamp(f.effectiveTaxRate, 0, taxMarginal + 0.05) : taxMarginal;
    sources.taxEffective = n(f.effectiveTaxRate) ? "TTM tax provision / pre-tax income" : "marginal rate";
    sources.taxMarginal = `statutory rate, ${country}`;
    let s2c = ind.values.salesToCapital;
    sources.salesToCapital = `industry sales / invested capital (${ctx.industrySource})`;
    if (!n(s2c)) {
      const ic = (f.bookEquity ?? 0) + (f.totalDebt ?? 0) - (f.cash ?? 0);
      s2c = n(rev) && ic > 0 ? clamp(rev / ic, 0.3, 5) : 1.5;
      sources.salesToCapital = "company revenue / invested capital";
    }
    const mcapRep = n(md.marketCap) ? md.marketCap / fxRepToTrading : 0;
    const rating = syntheticRating(f.ebitTtm, f.interestExpenseTtm);
    const coc = costOfCapital({
      riskFree: rf,
      erp,
      crp,
      unleveredBeta: ind.values.unleveredBeta ?? 1,
      marketCap: mcapRep,
      debt: f.totalDebt ?? 0,
      taxRate: taxMarginal,
      defaultSpread: rating.spread,
    });
    ctx.rating = rating.rating;
    ctx.leveredBeta = coc.leveredBeta;
    ctx.costOfEquity = coc.costOfEquity;
    sources.waccInitial = `rf ${(rf * 100).toFixed(2)}% + levered beta ${coc.leveredBeta.toFixed(2)} x (ERP ${(erp * 100).toFixed(2)}% + CRP ${(crp * 100).toFixed(2)}%); debt at ${rating.rating} spread; ${refLabel}`;
    sources.waccStable = "beta moves to 1 in stable growth";
    sources.stableGrowth = `capped at the ${reporting} risk-free rate`;
    sources.terminalRoic = "return on capital = cost of capital after year 10 (no excess returns)";
    return {
      model,
      sources,
      context: ctx,
      missing,
      inputs: {
        revenue: rev ?? 0,
        growthHigh: growth,
        stableGrowth: stableG,
        currentMargin: margin,
        targetMargin: target,
        marginConvergenceYear: 5,
        taxEffective: effTax,
        taxMarginal,
        salesToCapital: s2c,
        waccInitial: coc.wacc,
        waccStable: coc.stableWacc,
        terminalRoic: coc.stableWacc,
        cash: f.cash ?? 0,
        debt: f.totalDebt ?? 0,
        minorityInterest: f.minorityInterest ?? 0,
        nonOperatingAssets: 0,
        shares,
        interestExpense: Math.abs(f.interestExpenseTtm ?? 0),
        daPctRevenue: n(f.daTtm) && n(rev) && rev > 0 ? f.daTtm / rev : 0.04,
        dps0,
        failureProbability: 0,
        distressProceeds: 0.5,
        fxReportingToTrading: fxRepToTrading,
      },
    };
  }

  // Bottom-up beta, Damodaran style: industry unlevered beta re-levered at the industry debt/equity.
  // (Regression betas for SGX/HKEX names are often meaninglessly low.)
  const iv = ind.values;
  const bottomUp = n(iv.unleveredBeta) ? iv.unleveredBeta * (1 + (1 - (iv.taxRate ?? taxMarginal)) * (iv.deRatio ?? 0)) : null;
  const beta = bottomUp ?? yahooBeta ?? 1;
  sources.beta = bottomUp != null ? `industry bottom-up beta (${ctx.industrySource})` : yahooBeta != null ? "regression beta (Yahoo)" : "placeholder 1.0";
  const coe = rf + beta * (erp + crp);
  const coeStable = rf + 1 * (erp + crp);
  ctx.costOfEquity = coe;
  ctx.leveredBeta = beta;
  sources.costOfEquity = `rf ${(rf * 100).toFixed(2)}% + beta ${beta.toFixed(2)} x (ERP ${(erp * 100).toFixed(2)}% + CRP ${(crp * 100).toFixed(2)}%); ${refLabel}`;

  if (model === "excessReturn") {
    const bvps = f.bookValuePerShare ?? (n(f.bookEquity) && n(shares) ? f.bookEquity / shares : NaN);
    if (!n(bvps)) missing.push("book value per share");
    const roe = f.roe ?? (n(f.netIncomeTtm) && n(f.bookEquity) && f.bookEquity > 0 ? f.netIncomeTtm / f.bookEquity : 0.1);
    sources.roeCurrent = n(f.roe) ? "trailing ROE (Yahoo)" : "TTM net income / book equity";
    sources.roeStable = "halfway between current ROE and the stable cost of equity";
    sources.costOfEquityStable = "beta moves to 1 in stable growth";
    sources.payoutRatio = n(f.payoutRatio) ? "trailing payout ratio" : "placeholder 50%";
    sources.stableGrowth = `capped at the ${reporting} risk-free rate`;
    return {
      model,
      sources,
      context: ctx,
      missing,
      inputs: {
        bookValuePerShare: bvps,
        roeCurrent: clamp(roe, -0.2, 0.4),
        roeStable: (clamp(roe, -0.2, 0.4) + coeStable) / 2,
        costOfEquity: coe,
        costOfEquityStable: coeStable,
        payoutRatio: clamp(f.payoutRatio ?? 0.5, 0, 1),
        stableGrowth: stableG,
        shares,
        fxReportingToTrading: fxRepToTrading,
      },
    };
  }

  // REIT
  const ffoProxy = n(f.ffoTtm) && n(shares) ? f.ffoTtm / shares : NaN;
  const ffo = dps0 > 0 ? dps0 / 0.9 : ffoProxy;
  sources.ffoPerShare = dps0 > 0 ? "trailing distribution / 90% payout (distributable income proxy)" : "net income + D&A per unit (FFO proxy)";
  if (!n(ffo)) missing.push("FFO / distribution per unit");
  const dg = dividendGrowth(md.dividends);
  sources.growthHigh = n(dg) ? "historical distribution growth (limited to -3%..4%)" : "placeholder 2%";
  sources.payoutRatio = "REIT payout (90% minimum distribution)";
  sources.stableGrowth = "inflation-like growth, capped at 2.5%";
  sources.costOfEquityStable = "beta moves to 1 in stable growth";
  return {
    model,
    sources,
    context: ctx,
    missing,
    inputs: {
      ffoPerShare: ffo,
      growthHigh: clamp(dg ?? 0.02, -0.03, 0.04),
      stableGrowth: Math.min(rf, 0.025),
      payoutRatio: 0.9,
      costOfEquity: coe,
      costOfEquityStable: coeStable,
      fxReportingToTrading: fxRepToTrading,
    },
  };
}
