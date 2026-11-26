// Shared data shapes. MarketData mirrors what pipeline/yahoo.py writes.

export type AssetClass = "stock" | "bank" | "insurer" | "reit" | "etf" | "crypto" | "bond" | "cash";
export type Platform = "Tiger" | "Syfe" | "Longbridge" | "Crypto" | "Other";
export const PLATFORMS: Platform[] = ["Tiger", "Syfe", "Longbridge", "Crypto", "Other"];
export type TxType = "buy" | "sell" | "dividend" | "fee" | "deposit" | "withdrawal";

export interface Transaction {
  id: string;
  symbol: string;
  type: TxType;
  trade_date: string; // YYYY-MM-DD
  quantity: number;
  price: number; // per unit in `currency`; for dividend/fee rows the total amount (quantity 1)
  currency: string;
  fx_to_sgd: number | null; // SGD per unit of currency on trade date
  fees: number;
  platform: Platform | string;
  note?: string | null;
  import_ref?: string | null;
}

export interface MarketEvent {
  date: string;
  type: string; // earnings | dividend | split | agm | macro | unlock | custom
  title: string;
  symbol?: string | null;
}

export interface Fundamentals {
  revenueHistory?: { year: number; value: number }[];
  netIncomeHistory?: { year: number; value: number }[];
  bookEquityHistory?: { year: number; value: number }[];
  revenueTtm?: number | null;
  ebitTtm?: number | null;
  ebitdaTtm?: number | null;
  netIncomeTtm?: number | null;
  interestExpenseTtm?: number | null;
  effectiveTaxRate?: number | null;
  ocfTtm?: number | null;
  capexTtm?: number | null;
  daTtm?: number | null;
  fcfTtm?: number | null;
  dividendsPaidTtm?: number | null;
  totalDebt?: number | null;
  leaseLiabilities?: number | null;
  cash?: number | null;
  bookEquity?: number | null;
  minorityInterest?: number | null;
  eps?: number | null;
  bookValuePerShare?: number | null;
  roe?: number | null;
  payoutRatio?: number | null;
  operatingMargin?: number | null;
  ffoTtm?: number | null;
  revenueGrowthNextYear?: number | null;
  revenueGrowthThisYear?: number | null;
  epsGrowthLongTerm?: number | null;
  revenueGrowthYoy?: number | null;
}

export interface MarketData {
  symbol: string;
  updatedAt: string;
  name?: string;
  currency?: string;
  reportingCurrency?: string;
  exchange?: string | null;
  country?: string | null;
  sector?: string | null;
  industry?: string | null;
  assetClass?: AssetClass;
  price?: number | null;
  prevClose?: number | null;
  marketCap?: number | null;
  shares?: number | null;
  beta?: number | null;
  dividendRate?: number | null;
  dividendYield?: number | null;
  fiftyTwoWeekHigh?: number | null;
  fiftyTwoWeekLow?: number | null;
  multiples?: { pe?: number | null; forwardPe?: number | null; pb?: number | null; evEbitda?: number | null; evRevenue?: number | null };
  analyst?: { targetMean?: number | null; recommendation?: string | null; numAnalysts?: number | null };
  history?: [string, number][];
  fundamentals?: Fundamentals;
  events?: MarketEvent[];
  dividends?: { date: string; amount: number }[];
  insiders?: { date: string; insider: string; position?: string; text?: string; shares?: number; value?: number }[];
  institutions?: { date: string; holder: string; pctHeld?: number; shares?: number; value?: number; pctChange?: number }[];
  news?: { title: string; publisher?: string; url?: string; time?: string }[];
  crypto?: { circulatingSupply?: number | null; volume24h?: number | null; allTimeHigh?: number | null; fullyDilutedValuation?: number | null; coingeckoId?: string };
  gaps?: string[];
}

export interface IndustryRef {
  unleveredBeta?: number;
  deRatio?: number;
  taxRate?: number;
  operatingMargin?: number;
  netMargin?: number;
  salesToCapital?: number;
  pe?: number;
  forwardPe?: number;
  evEbitda?: number;
  pb?: number;
  roe?: number;
  costOfCapital?: number;
  costOfEquity?: number;
  expectedGrowth?: number;
}

export interface ReferenceData {
  erp?: number;
  riskFree?: Record<string, number>;
  countries?: Record<string, { erp?: number; crp?: number }>;
  industries?: Record<string, Record<string, IndustryRef>>; // region -> industry -> metrics
  updatedAt?: string;
  source?: string;
}

export interface Instrument {
  symbol: string;
  name?: string | null;
  asset_class?: AssetClass | null;
  currency?: string | null;
  manual_price?: number | null;
  manual_price_date?: string | null;
  extra?: { targetPrice5y?: number | null; [k: string]: unknown };
}

export interface JournalEntry {
  id: string;
  symbol: string;
  entry_date: string;
  tags: string[];
  body: string;
}

export interface Alert {
  id: string;
  symbol?: string | null;
  kind: string;
  message: string;
  created_at: string;
  read: boolean;
}

export type ScenarioName = "bear" | "base" | "bull";

/** What the user changed. Stored per symbol in `valuations.data`. */
export interface ValuationSettings {
  overrides: Partial<Record<ScenarioName, Record<string, number | string>>>;
  probabilities: Record<ScenarioName, number>;
  /** Value of each overridden field's computed default at the time the user edited it, to flag drift later. */
  baselineAtEdit?: Record<string, number>;
  comps?: string[];
  exitMetric?: string;
  exitMultiple?: number | null;
  model?: string; // force a model
  industry?: string; // Damodaran industry override
}

/** A logged investment decision (buy/add/trim/sell/pass) with the reasoning at the time, for later post-mortems. */
export interface Decision {
  id: string;
  symbol: string;
  decision_date: string; // YYYY-MM-DD
  action: "buy" | "add" | "trim" | "sell" | "pass";
  price: number; // trading currency
  thesis: string;
  target_price?: number | null;
  stop_price?: number | null;
  conviction?: number | null; // 1-5
  horizon_months?: number | null;
  dcf_value?: number | null; // probability-weighted DCF value when the decision was logged
  review?: string | null;
  outcome?: "good-good" | "good-bad" | "bad-good" | "bad-bad" | null; // decision quality - outcome
  reviewed_at?: string | null;
}

export type TripMetric = "revenueGrowth" | "operatingMargin" | "netMargin" | "fcfMargin" | "roe" | "pe" | "price" | "priceToDcf" | "drawdown";

/** A thesis tripwire: flag when a metric crosses a threshold. Stored in instruments.extra.tripwires. */
export interface Tripwire {
  id: string;
  metric: TripMetric;
  op: "<" | ">";
  value: number; // decimals for % metrics (0.2 = 20%)
  note?: string;
}

/** Weekly closes of benchmarks for beta and stress tests (reference_data key "benchmarks"). */
export type Benchmarks = Record<string, [string, number][]>;
