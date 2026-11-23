// Valuation models, Damodaran style. All money values in the company's REPORTING currency; per-share
// results are converted to the TRADING currency with `fxReportingToTrading` at the end.
//
// Structure shared by all three models: years 1-5 high growth, years 6-10 linear fade to stable growth,
// terminal value after year 10.

export type Inputs = Record<string, number>;

export interface YearRow {
  year: number;
  growth: number;
  discountRate: number;
  discountFactor: number;
  cashFlow: number; // FCFF (firm) or dividends/excess returns (equity), total
  pv: number;
  // per-share metrics used by the exit-multiple target (reporting currency)
  eps: number;
  dps: number;
  fcfePerShare?: number;
  ebitdaPerShare?: number;
  bvps?: number;
  ffoPerShare?: number;
  [k: string]: number | undefined;
}

export interface ModelResult {
  model: ModelId;
  valuePerShare: number; // trading currency
  valuePerShareReporting: number;
  years: YearRow[];
  terminal: { cashFlow: number; value: number; pv: number; growth: number; discountRate: number };
  /** Intrinsic value per share at the end of year 5 (reporting currency), used to derive a growth-justified exit multiple. */
  valueAtYear5PerShare: number;
  /** Enterprise value at end of year 5 per share (FCFF model only). */
  evAtYear5PerShare?: number;
  netDebtPerShare: number;
  breakdown: { label: string; value: number }[];
  warnings: string[];
}

export type ModelId = "fcff" | "excessReturn" | "reitDdm";

export const MODEL_LABELS: Record<ModelId, string> = {
  fcff: "FCFF DCF (operating company)",
  excessReturn: "Excess return model (bank / insurer)",
  reitDdm: "FFO dividend discount (REIT)",
};

/** growth path: years 1-5 at `high`, years 6-10 fade linearly to `stable`. */
/** Per-year override key for year t, e.g. g3 = growth in year 3. Returns null when not set. */
export const PER_YEAR_PREFIXES = ["g", "m", "w"] as const;
export function yearOverride(i: Inputs, prefix: (typeof PER_YEAR_PREFIXES)[number], t: number): number | null {
  const v = i[`${prefix}${t}`];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
export const isPerYearKey = (k: string) => /^[gmw]([1-9]|10)$/.test(k);

export function growthPath(high: number, stable: number): number[] {
  const g: number[] = [];
  for (let t = 1; t <= 10; t++) g.push(t <= 5 ? high : high - ((high - stable) * (t - 5)) / 5);
  return g;
}

/** a value held at `start` for years 1-5 then fading linearly to `end` by year 10 */
export function fadePath(start: number, end: number): number[] {
  return growthPath(start, end);
}

function finish(
  model: ModelId,
  equityValue: number,
  shares: number,
  fx: number,
  years: YearRow[],
  terminal: ModelResult["terminal"],
  valueAt5: number,
  netDebtPerShare: number,
  breakdown: { label: string; value: number }[],
  warnings: string[],
  evAt5?: number,
): ModelResult {
  // Limited liability: shareholders can't be worth less than zero.
  if (equityValue < 0) warnings.push("Equity value is below zero at these assumptions; shown as 0 per share.");
  const perShareRep = shares > 0 ? Math.max(0, equityValue) / shares : NaN;
  return {
    model,
    valuePerShare: perShareRep * fx,
    valuePerShareReporting: perShareRep,
    years,
    terminal,
    valueAtYear5PerShare: valueAt5,
    evAtYear5PerShare: evAt5,
    netDebtPerShare,
    breakdown,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// 1. FCFF DCF for operating companies

export const FCFF_FIELDS = [
  "revenue",
  "growthHigh",
  "stableGrowth",
  "currentMargin",
  "targetMargin",
  "marginConvergenceYear",
  "taxEffective",
  "taxMarginal",
  "salesToCapital",
  "waccInitial",
  "waccStable",
  "terminalRoic",
  "cash",
  "debt",
  "minorityInterest",
  "nonOperatingAssets",
  "shares",
  "interestExpense",
  "daPctRevenue",
  "dps0",
  "failureProbability",
  "distressProceeds",
  "fxReportingToTrading",
] as const;

export function fcffModel(i: Inputs): ModelResult {
  const warnings: string[] = [];
  // Per-year overrides (g1..g10 growth, m1..m10 operating margin, w1..w10 cost of capital) win over the paths.
  const g = growthPath(i.growthHigh, i.stableGrowth).map((x, k) => yearOverride(i, "g", k + 1) ?? x);
  const wacc = fadePath(i.waccInitial, i.waccStable).map((x, k) => yearOverride(i, "w", k + 1) ?? x);
  const N = Math.max(1, Math.round(i.marginConvergenceYear || 5));
  const years: YearRow[] = [];
  let rev = i.revenue;
  let df = 1;
  const eps0 = i.shares > 0 ? ((i.revenue * i.currentMargin - (i.interestExpense || 0)) * (1 - i.taxEffective)) / i.shares : 0;
  for (let t = 1; t <= 10; t++) {
    const prev = rev;
    rev = prev * (1 + g[t - 1]);
    const margin = yearOverride(i, "m", t) ?? (t >= N ? i.targetMargin : i.targetMargin - ((i.targetMargin - i.currentMargin) * (N - t)) / N);
    const ebit = rev * margin;
    const tax = t <= 5 ? i.taxEffective : i.taxEffective + ((i.taxMarginal - i.taxEffective) * (t - 5)) / 5;
    const nopat = ebit > 0 ? ebit * (1 - tax) : ebit; // no tax on losses (simplification: ignores NOL carry-forward)
    const reinvestment = (rev - prev) / i.salesToCapital;
    const fcff = nopat - reinvestment;
    df = df / (1 + wacc[t - 1]);
    const ni = (ebit - (i.interestExpense || 0)) * (1 - (ebit > 0 ? tax : 0));
    const eps = ni / i.shares;
    const dps = eps0 > 0 && i.dps0 > 0 ? i.dps0 * Math.max(0, eps / eps0) : i.dps0 || 0;
    years.push({
      year: t,
      growth: g[t - 1],
      revenue: rev,
      margin,
      ebit,
      taxRate: tax,
      nopat,
      reinvestment,
      discountRate: wacc[t - 1],
      discountFactor: df,
      cashFlow: fcff,
      pv: fcff * df,
      eps,
      dps,
      fcfePerShare: (fcff - (i.interestExpense || 0) * (1 - tax)) / i.shares,
      ebitdaPerShare: (ebit + rev * (i.daPctRevenue || 0)) / i.shares,
    });
  }
  const gS = i.stableGrowth;
  const rS = i.waccStable;
  if (rS <= gS) warnings.push("Stable cost of capital must be above stable growth; terminal value is not meaningful.");
  if (gS > 0.05) warnings.push("Stable growth above 5% is higher than most economies can sustain forever.");
  const rev11 = rev * (1 + gS);
  const ebit11 = rev11 * (years[9]?.margin ?? i.targetMargin); // terminal margin = year-10 margin
  const nopat11 = ebit11 * (1 - i.taxMarginal);
  const reinvRate = i.terminalRoic > 0 ? gS / i.terminalRoic : 0;
  const fcff11 = nopat11 * (1 - reinvRate);
  const tv = rS > gS ? fcff11 / (rS - gS) : NaN;
  const pvTv = tv * df;
  const pvSum = years.reduce((s, y) => s + y.pv, 0);
  let operating = pvSum + pvTv;
  const pFail = i.failureProbability || 0;
  if (pFail > 0) operating = operating * (1 - pFail) + operating * (i.distressProceeds ?? 0.5) * pFail;
  const equity = operating + (i.cash || 0) + (i.nonOperatingAssets || 0) - (i.debt || 0) - (i.minorityInterest || 0);

  // value of the firm at end of year 5 (for the growth-justified exit multiple)
  const df5 = years[4].discountFactor;
  const ev5 = (years.slice(5).reduce((s, y) => s + y.pv, 0) + pvTv) / df5;
  const netDebt = (i.debt || 0) + (i.minorityInterest || 0) - (i.cash || 0) - (i.nonOperatingAssets || 0);
  const breakdown = [
    { label: "PV of cash flows, years 1-10", value: pvSum },
    { label: "PV of terminal value", value: pvTv },
    ...(pFail > 0 ? [{ label: "Adjustment for failure risk", value: operating - (pvSum + pvTv) }] : []),
    { label: "Value of operating assets", value: operating },
    { label: "+ Cash and non-operating assets", value: (i.cash || 0) + (i.nonOperatingAssets || 0) },
    { label: "- Debt", value: -(i.debt || 0) },
    { label: "- Minority interests", value: -(i.minorityInterest || 0) },
    { label: "Value of equity", value: equity },
  ];
  return finish(
    "fcff",
    equity,
    i.shares,
    i.fxReportingToTrading || 1,
    years,
    { cashFlow: fcff11, value: tv, pv: pvTv, growth: gS, discountRate: rS },
    (ev5 - netDebt) / i.shares,
    netDebt / i.shares,
    breakdown,
    warnings,
    ev5 / i.shares,
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Excess return model for banks and insurers (equity valued directly; debt is raw material)

export const EXCESS_RETURN_FIELDS = [
  "bookValuePerShare",
  "roeCurrent",
  "roeStable",
  "costOfEquity",
  "costOfEquityStable",
  "payoutRatio",
  "stableGrowth",
  "shares",
  "fxReportingToTrading",
] as const;

export function excessReturnModel(i: Inputs): ModelResult {
  const warnings: string[] = [];
  const roe = fadePath(i.roeCurrent, i.roeStable);
  const coe = fadePath(i.costOfEquity, i.costOfEquityStable);
  const stablePayout = i.roeStable > 0 ? 1 - i.stableGrowth / i.roeStable : 1;
  const payout = fadePath(i.payoutRatio, stablePayout);
  let bv = i.bookValuePerShare;
  let df = 1;
  const years: YearRow[] = [];
  for (let t = 1; t <= 10; t++) {
    const eps = roe[t - 1] * bv;
    const excess = (roe[t - 1] - coe[t - 1]) * bv;
    df = df / (1 + coe[t - 1]);
    const dps = eps * payout[t - 1];
    const bvEnd = bv + eps - dps;
    years.push({
      year: t,
      growth: bv > 0 ? bvEnd / bv - 1 : 0,
      roe: roe[t - 1],
      costOfEquity: coe[t - 1],
      bvBegin: bv,
      discountRate: coe[t - 1],
      discountFactor: df,
      cashFlow: excess,
      pv: excess * df,
      eps,
      dps,
      bvps: bvEnd,
    });
    bv = bvEnd;
  }
  const gS = i.stableGrowth;
  const rS = i.costOfEquityStable;
  if (rS <= gS) warnings.push("Stable cost of equity must be above stable growth.");
  const excess11 = (i.roeStable - rS) * bv;
  const tv = rS > gS ? excess11 / (rS - gS) : NaN;
  const pvTv = tv * df;
  const pvSum = years.reduce((s, y) => s + y.pv, 0);
  const perShare = i.bookValuePerShare + pvSum + pvTv;
  const df5 = years[4].discountFactor;
  const val5 = years[4].bvps! + (years.slice(5).reduce((s, y) => s + y.pv, 0) + pvTv) / df5;
  return finish(
    "excessReturn",
    perShare,
    1,
    i.fxReportingToTrading || 1,
    years,
    { cashFlow: excess11, value: tv, pv: pvTv, growth: gS, discountRate: rS },
    val5,
    0,
    [
      { label: "Current book value per share", value: i.bookValuePerShare },
      { label: "PV of excess returns, years 1-10", value: pvSum },
      { label: "PV of terminal excess returns", value: pvTv },
      { label: "Value per share", value: perShare },
    ],
    warnings,
  );
}

// ---------------------------------------------------------------------------------------------
// 3. REITs: dividend discount on FFO (REITs must pay out most of their income)

export const REIT_FIELDS = [
  "ffoPerShare",
  "growthHigh",
  "stableGrowth",
  "payoutRatio",
  "costOfEquity",
  "costOfEquityStable",
  "fxReportingToTrading",
] as const;

export function reitModel(i: Inputs): ModelResult {
  const warnings: string[] = [];
  const g = growthPath(i.growthHigh, i.stableGrowth);
  const coe = fadePath(i.costOfEquity, i.costOfEquityStable);
  let ffo = i.ffoPerShare;
  let df = 1;
  const years: YearRow[] = [];
  for (let t = 1; t <= 10; t++) {
    ffo = ffo * (1 + g[t - 1]);
    const dps = ffo * i.payoutRatio;
    df = df / (1 + coe[t - 1]);
    years.push({ year: t, growth: g[t - 1], discountRate: coe[t - 1], discountFactor: df, cashFlow: dps, pv: dps * df, eps: ffo, dps, ffoPerShare: ffo });
  }
  const gS = i.stableGrowth;
  const rS = i.costOfEquityStable;
  if (rS <= gS) warnings.push("Stable cost of equity must be above stable growth.");
  const d11 = ffo * (1 + gS) * i.payoutRatio;
  const tv = rS > gS ? d11 / (rS - gS) : NaN;
  const pvTv = tv * df;
  const pvSum = years.reduce((s, y) => s + y.pv, 0);
  const df5 = years[4].discountFactor;
  const val5 = (years.slice(5).reduce((s, y) => s + y.pv, 0) + pvTv) / df5;
  return finish(
    "reitDdm",
    pvSum + pvTv,
    1,
    i.fxReportingToTrading || 1,
    years,
    { cashFlow: d11, value: tv, pv: pvTv, growth: gS, discountRate: rS },
    val5,
    0,
    [
      { label: "PV of distributions, years 1-10", value: pvSum },
      { label: "PV of terminal value", value: pvTv },
      { label: "Value per unit", value: pvSum + pvTv },
    ],
    warnings,
  );
}

export function runModel(model: ModelId, inputs: Inputs): ModelResult {
  if (model === "excessReturn") return excessReturnModel(inputs);
  if (model === "reitDdm") return reitModel(inputs);
  return fcffModel(inputs);
}
