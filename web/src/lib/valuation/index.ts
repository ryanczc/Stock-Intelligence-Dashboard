// Orchestrates a full valuation for one symbol: defaults -> user overrides -> bear/base/bull ->
// probability-weighted value -> 5-year exit-multiple price target -> CAGR, plus drift flags.
import type { Instrument, MarketData, ReferenceData, ScenarioName, ValuationSettings } from "../types";
import { buildDefaults, clamp, type Defaults, type FxTable, fxRate } from "./defaults";
import { runModel, type Inputs, type ModelId, type ModelResult } from "./models";
import type { ClaudeCase } from "./claude";

export * from "./models";
export * from "./defaults";
export * from "./claude";

export const SCENARIOS: ScenarioName[] = ["bear", "base", "bull"];
export const DEFAULT_PROBABILITIES: Record<ScenarioName, number> = { bear: 0.25, base: 0.5, bull: 0.25 };

/** Default bear/bull adjustments relative to the (user-adjusted) base case. */
export function scenarioDefaults(model: ModelId, base: Inputs, s: ScenarioName): Partial<Inputs> {
  if (s === "base") return {};
  const bear = s === "bear";
  if (model === "fcff") {
    const g = base.growthHigh;
    return {
      growthHigh: g > 0 ? g * (bear ? 0.5 : 1.35) : g + (bear ? -0.03 : 0.03),
      targetMargin: base.targetMargin * (bear ? 0.85 : 1.1),
    };
  }
  if (model === "excessReturn") {
    return { roeCurrent: base.roeCurrent + (bear ? -0.02 : 0.02), roeStable: base.roeStable + (bear ? -0.01 : 0.01) };
  }
  return { growthHigh: base.growthHigh + (bear ? -0.015 : 0.01) };
}

export type ExitMetric = "pe" | "pfcf" | "evEbitda" | "pb" | "pffo";
export const EXIT_METRICS: Record<ExitMetric, { label: string; perShare: string; metricLabel: string }> = {
  pe: { label: "P/E", perShare: "eps", metricLabel: "EPS" },
  pfcf: { label: "P/FCF", perShare: "fcfePerShare", metricLabel: "FCF per share" },
  evEbitda: { label: "EV/EBITDA", perShare: "ebitdaPerShare", metricLabel: "EBITDA per share" },
  pb: { label: "P/B", perShare: "bvps", metricLabel: "book value per share" },
  pffo: { label: "P/FFO", perShare: "ffoPerShare", metricLabel: "FFO per unit" },
};

export function defaultExitMetric(model: ModelId, sector?: string | null, industry?: string | null): ExitMetric {
  if (model === "excessReturn") return "pb";
  if (model === "reitDdm") return "pffo";
  const s = (sector || "").toLowerCase();
  const i = (industry || "").toLowerCase();
  // capital-heavy or cyclical industries are normally priced on EV/EBITDA; everything else on P/E
  if (/energy|utilities|basic materials|industrials/.test(s) || /telecom|airlines|marine|railroad|oil|gas/.test(i)) return "evEbitda";
  return "pe";
}

export function allowedExitMetrics(model: ModelId): ExitMetric[] {
  if (model === "excessReturn") return ["pb", "pe"];
  if (model === "reitDdm") return ["pffo"];
  return ["pe", "pfcf", "evEbitda"];
}

const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Trailing multiple of a comparable company for a given metric, from its market data. */
export function compMultiple(c: MarketData, metric: ExitMetric, fx: FxTable): number | null {
  const f = c.fundamentals ?? {};
  const fxr = fxRate(fx, c.reportingCurrency ?? c.currency ?? "USD", c.currency ?? "USD") || 1;
  const ok = (x: number | null | undefined) => (typeof x === "number" && x > 0 && x < 200 ? x : null);
  if (metric === "pe") return ok(c.multiples?.pe);
  if (metric === "pb") return ok(c.multiples?.pb);
  if (metric === "evEbitda") return ok(c.multiples?.evEbitda);
  if (metric === "pfcf") return c.marketCap && f.fcfTtm ? ok(c.marketCap / (f.fcfTtm * fxr)) : null;
  if (metric === "pffo") return c.price && f.ffoTtm && c.shares ? ok(c.price / ((f.ffoTtm / c.shares) * fxr)) : null;
  return null;
}

export interface ExitCandidate {
  source: string;
  multiple: number;
}

export interface ExitResult {
  metric: ExitMetric;
  metricValueYear5: number; // per share, reporting currency
  netIncomeYear5: number | null; // total, reporting currency (base case)
  candidates: ExitCandidate[];
  multiple: number;
  multipleSource: string;
  priceTarget: number; // trading currency
  dividends5y: number; // trading currency, sum of projected DPS years 1-5
  cagr: number | null;
}

export function exitTarget(
  base: ModelResult,
  _model: ModelId,
  metric: ExitMetric,
  ctx: Defaults["context"],
  comps: MarketData[],
  fx: FxTable,
  price: number | null | undefined,
  fxRepToTrading: number,
  userMultiple?: number | null,
  own?: number | null,
  userMultipleLabel = "Your multiple",
): ExitResult {
  const y5 = base.years[4];
  const key = EXIT_METRICS[metric].perShare;
  const m5 = (y5[key] as number | undefined) ?? NaN;
  const candidates: ExitCandidate[] = [];
  const compVals = comps.map((c) => compMultiple(c, metric, fx)).filter((x): x is number => x != null);
  if (compVals.length) candidates.push({ source: `Comps median (${compVals.length})`, multiple: median(compVals) });
  const indVal = metric === "pe" ? ctx.industryMultiples.pe : metric === "evEbitda" ? ctx.industryMultiples.evEbitda : metric === "pb" ? ctx.industryMultiples.pb : undefined;
  const cap = metric === "evEbitda" ? 40 : metric === "pb" ? 15 : 80; // industry aggregates can be distorted by loss-makers
  if (indVal && indVal > 0 && indVal < cap) candidates.push({ source: `Industry: ${ctx.industry} (${ctx.industrySource})`, multiple: indVal });
  if (own != null && own > 0 && own < 200) candidates.push({ source: "Company's current multiple", multiple: own });
  const justifiedNumerator = metric === "evEbitda" ? base.evAtYear5PerShare ?? NaN : base.valueAtYear5PerShare;
  const justified = m5 > 0 ? justifiedNumerator / m5 : NaN;
  if (Number.isFinite(justified) && justified > 0 && justified < 200) candidates.push({ source: "Growth-justified (DCF value at year 5)", multiple: justified });

  let multiple: number;
  let multipleSource: string;
  if (userMultiple && userMultiple > 0) {
    multiple = userMultiple;
    multipleSource = userMultipleLabel;
  } else if (candidates.length) {
    multiple = median(candidates.map((c) => c.multiple));
    multipleSource = candidates.length > 1 ? "Median of the candidates" : candidates[0].source;
  } else {
    multiple = NaN;
    multipleSource = "No multiple available";
  }
  const ptRep = metric === "evEbitda" ? m5 * multiple - base.netDebtPerShare : m5 * multiple;
  const priceTarget = ptRep * fxRepToTrading;
  const dividends5y = base.years.slice(0, 5).reduce((s, y) => s + (y.dps || 0), 0) * fxRepToTrading;
  return { metric, metricValueYear5: m5, netIncomeYear5: null, candidates, multiple, multipleSource, priceTarget, dividends5y, cagr: cagr(price, priceTarget, dividends5y) };
}

/** Total-return CAGR over 5 years, counting dividends received (not reinvested). */
export function cagr(price: number | null | undefined, target: number, dividends = 0, years = 5): number | null {
  if (!price || price <= 0 || !Number.isFinite(target) || target + dividends <= 0) return null;
  return Math.pow((target + dividends) / price, 1 / years) - 1;
}

export interface DriftFlag {
  field: string;
  whenEdited: number;
  now: number;
}

export interface Valuation {
  kind: "model";
  defaults: Defaults;
  model: ModelId;
  probabilities: Record<ScenarioName, number>;
  inputs: Record<ScenarioName, Inputs>;
  results: Record<ScenarioName, ModelResult>;
  weightedValue: number;
  exit: ExitResult;
  drift: DriftFlag[];
  price: number | null;
  upside: number | null;
  /** Researched defaults applied between the data defaults and the user's edits, if any. */
  claude: ClaudeCase | null;
  /** The automatic data-driven defaults, before the Claude base case. */
  dataInputs: Inputs;
}

export interface SimpleTarget {
  kind: "target";
  targetPrice5y: number | null;
  cagr: number | null;
  price: number | null;
  claude?: ClaudeCase | null;
}

export function applyOverrides(inputs: Inputs, ov: Record<string, number | string> | undefined): Inputs {
  if (!ov) return inputs;
  const out = { ...inputs };
  for (const [k, v] of Object.entries(ov)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  return out;
}

export function normaliseProbabilities(p: Record<ScenarioName, number>): Record<ScenarioName, number> {
  const tot = p.bear + p.base + p.bull;
  if (!(tot > 0)) return DEFAULT_PROBABILITIES;
  return { bear: p.bear / tot, base: p.base / tot, bull: p.bull / tot };
}

/** Fields the user overrode whose computed default has since moved by more than 15% (relative) or 1.5pp. */
export function detectDrift(defaults: Inputs, settings: ValuationSettings | undefined): DriftFlag[] {
  const base = settings?.overrides?.base;
  const at = settings?.baselineAtEdit;
  if (!base || !at) return [];
  const out: DriftFlag[] = [];
  for (const k of Object.keys(base)) {
    const was = at[k];
    const now = defaults[k];
    if (typeof was !== "number" || typeof now !== "number" || !Number.isFinite(was) || !Number.isFinite(now)) continue;
    const absDiff = Math.abs(now - was);
    const rel = was !== 0 ? absDiff / Math.abs(was) : absDiff;
    const isRate = Math.abs(was) < 1 && Math.abs(now) < 1;
    if ((isRate && absDiff > 0.015) || (!isRate && rel > 0.15)) out.push({ field: k, whenEdited: was, now });
  }
  return out;
}

export function valueSymbol(
  md: MarketData | undefined,
  ref: ReferenceData | null | undefined,
  fx: FxTable,
  settings: ValuationSettings | undefined,
  comps: MarketData[] = [],
  instrument?: Instrument,
  claude?: ClaudeCase | null,
): Valuation | SimpleTarget | null {
  if (!md) return null;
  const price = md.price ?? instrument?.manual_price ?? null;
  const cc = claude && !claude.noDcf ? claude : null;
  const forcedModel = (settings?.model || cc?.model) as ModelId | undefined;
  const defaults = buildDefaults(md, ref, fx, { industry: settings?.industry || cc?.industry, model: forcedModel });
  if (!defaults || (claude?.noDcf && !settings?.model)) {
    const t = instrument?.extra?.targetPrice5y ?? null;
    const divs = (md.dividendRate ?? 0) * 5;
    return { kind: "target", targetPrice5y: t, cagr: t ? cagr(price, t, divs) : null, price, claude: claude ?? null };
  }
  // Layer the Claude base case on top of the data defaults; the result is what the page calls "default".
  const dataInputs = defaults.inputs;
  if (cc?.base) {
    defaults.inputs = applyOverrides(dataInputs, cc.base);
    for (const k of Object.keys(cc.base)) {
      if (!(k in dataInputs)) continue;
      defaults.sources[k] = `Claude base case ${cc.asOf}: ${cc.rationale?.[k] ?? "researched estimate"}`;
    }
  }
  const probabilities = normaliseProbabilities(settings?.probabilities ?? cc?.probabilities ?? DEFAULT_PROBABILITIES);
  const baseInputs = applyOverrides(defaults.inputs, settings?.overrides?.base as Record<string, number>);
  const inputs = {} as Record<ScenarioName, Inputs>;
  const results = {} as Record<ScenarioName, ModelResult>;
  for (const s of SCENARIOS) {
    if (s === "base") inputs[s] = baseInputs;
    else {
      const scn = applyOverrides({ ...baseInputs, ...scenarioDefaults(defaults.model, baseInputs, s) } as Inputs, cc?.[s]);
      inputs[s] = applyOverrides(scn, settings?.overrides?.[s] as Record<string, number>);
    }
    results[s] = runModel(defaults.model, inputs[s]);
  }
  const weightedValue = SCENARIOS.reduce((sum, s) => sum + probabilities[s] * results[s].valuePerShare, 0);
  const allowed = allowedExitMetrics(defaults.model);
  const wanted = (settings?.exitMetric || cc?.exitMetric || defaultExitMetric(defaults.model, md.sector, md.industry)) as ExitMetric;
  const metric = allowed.includes(wanted) ? wanted : allowed[0];
  // Claude's multiple applies only to the metric it was set for.
  const claudeMultiple = cc?.exitMultiple && (cc.exitMetric ?? metric) === metric ? cc.exitMultiple : null;
  const userMultiple = settings?.exitMultiple ?? null;
  const exit = exitTarget(
    results.base, defaults.model, metric, defaults.context, comps, fx, price, baseInputs.fxReportingToTrading || 1,
    userMultiple ?? claudeMultiple, compMultiple(md, metric, fx),
    userMultiple ? "Your multiple" : `Claude base case ${cc?.asOf ?? ""}`.trim(),
  );
  const eps5 = results.base.years[4]?.eps;
  const shares = baseInputs.shares ?? md.shares;
  if (typeof eps5 === "number" && typeof shares === "number" && shares > 0) exit.netIncomeYear5 = eps5 * shares;
  return {
    kind: "model",
    defaults,
    model: defaults.model,
    probabilities,
    inputs,
    results,
    weightedValue,
    exit,
    drift: detectDrift(defaults.inputs, settings),
    price,
    upside: price && Number.isFinite(weightedValue) ? clamp(weightedValue / price - 1, -1, 100) : null,
    claude: cc,
    dataInputs,
  };
}
