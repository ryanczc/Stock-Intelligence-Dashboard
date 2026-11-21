import type { ModelId } from "./models";

export type FieldKind = "pct" | "money" | "num" | "x" | "int";
export interface FieldMeta {
  key: string;
  label: string;
  kind: FieldKind;
  help: string;
  group: string;
  advanced?: boolean;
}

const fcff: FieldMeta[] = [
  { key: "revenue", label: "Base revenue (TTM)", kind: "money", group: "Growth", help: "Trailing twelve-month revenue, reporting currency." },
  { key: "growthHigh", label: "Revenue growth, years 1-5", kind: "pct", group: "Growth", help: "Annual growth during the high-growth period." },
  { key: "stableGrowth", label: "Stable growth (after year 10)", kind: "pct", group: "Growth", help: "Growth fades linearly from the high rate to this in years 6-10. Should not exceed the risk-free rate." },
  { key: "currentMargin", label: "Current operating margin", kind: "pct", group: "Profitability", help: "TTM EBIT / revenue." },
  { key: "targetMargin", label: "Target operating margin", kind: "pct", group: "Profitability", help: "Pre-tax operating margin the business converges to." },
  { key: "marginConvergenceYear", label: "Year margin reaches target", kind: "int", group: "Profitability", help: "Margin moves linearly from current to target by this year." },
  { key: "salesToCapital", label: "Sales to capital", kind: "x", group: "Reinvestment", help: "Revenue added per unit of capital invested. Reinvestment = change in revenue / this." },
  { key: "terminalRoic", label: "Return on capital after year 10", kind: "pct", group: "Reinvestment", help: "Sets terminal reinvestment = stable growth / ROIC. Equal to the cost of capital means no excess returns." },
  { key: "waccInitial", label: "Cost of capital, years 1-5", kind: "pct", group: "Risk", help: "WACC from bottom-up beta, ERP and country risk premium." },
  { key: "waccStable", label: "Cost of capital, after year 10", kind: "pct", group: "Risk", help: "Fades linearly from the initial WACC in years 6-10." },
  { key: "failureProbability", label: "Probability of failure", kind: "pct", group: "Risk", help: "Chance the business fails; value is then distress proceeds." },
  { key: "distressProceeds", label: "Distress proceeds (% of value)", kind: "pct", group: "Risk", help: "What is recovered if it fails.", advanced: true },
  { key: "taxEffective", label: "Effective tax rate", kind: "pct", group: "Tax", help: "Used for years 1-5, moving to marginal by year 10." },
  { key: "taxMarginal", label: "Marginal tax rate", kind: "pct", group: "Tax", help: "Statutory rate, used in terminal year." },
  { key: "cash", label: "Cash and investments", kind: "money", group: "Balance sheet", help: "Added to operating asset value." },
  { key: "debt", label: "Debt (incl. leases)", kind: "money", group: "Balance sheet", help: "Subtracted to get equity value." },
  { key: "minorityInterest", label: "Minority interests", kind: "money", group: "Balance sheet", help: "Subtracted." },
  { key: "nonOperatingAssets", label: "Other non-operating assets", kind: "money", group: "Balance sheet", help: "Cross-holdings etc. Added.", advanced: true },
  { key: "shares", label: "Shares outstanding", kind: "num", group: "Balance sheet", help: "Diluted share count." },
  { key: "interestExpense", label: "Interest expense", kind: "money", group: "Per-share projections", help: "Used to project net income for the P/E exit target.", advanced: true },
  { key: "daPctRevenue", label: "D&A as % of revenue", kind: "pct", group: "Per-share projections", help: "Used to project EBITDA for EV/EBITDA exits.", advanced: true },
  { key: "dps0", label: "Current dividend per share", kind: "money", group: "Per-share projections", help: "Grows with EPS; counted in CAGR.", advanced: true },
  { key: "fxReportingToTrading", label: "FX: reporting to trading currency", kind: "num", group: "Currency", help: "Converts per-share value into the listing currency.", advanced: true },
];

const excessReturn: FieldMeta[] = [
  { key: "bookValuePerShare", label: "Book value per share", kind: "money", group: "Equity", help: "Current book equity per share." },
  { key: "roeCurrent", label: "ROE, years 1-5", kind: "pct", group: "Returns", help: "Return on equity during the high-return period." },
  { key: "roeStable", label: "ROE after year 10", kind: "pct", group: "Returns", help: "ROE fades linearly to this in years 6-10." },
  { key: "costOfEquity", label: "Cost of equity, years 1-5", kind: "pct", group: "Risk", help: "rf + beta x (ERP + CRP)." },
  { key: "costOfEquityStable", label: "Cost of equity, after year 10", kind: "pct", group: "Risk", help: "Beta moves to 1." },
  { key: "payoutRatio", label: "Payout ratio, years 1-5", kind: "pct", group: "Payout", help: "Fades to 1 - g/ROE in stable growth. Retained earnings grow book value." },
  { key: "stableGrowth", label: "Stable growth", kind: "pct", group: "Payout", help: "Growth in book value after year 10." },
  { key: "fxReportingToTrading", label: "FX: reporting to trading currency", kind: "num", group: "Currency", help: "", advanced: true },
];

const reit: FieldMeta[] = [
  { key: "ffoPerShare", label: "FFO / distributable income per unit", kind: "money", group: "Cash flow", help: "Starting FFO per unit." },
  { key: "growthHigh", label: "FFO growth, years 1-5", kind: "pct", group: "Cash flow", help: "Fades to stable growth in years 6-10." },
  { key: "stableGrowth", label: "Stable growth", kind: "pct", group: "Cash flow", help: "Long-run growth, around inflation." },
  { key: "payoutRatio", label: "Payout of FFO", kind: "pct", group: "Cash flow", help: "Share of FFO paid as distributions." },
  { key: "costOfEquity", label: "Cost of equity, years 1-5", kind: "pct", group: "Risk", help: "" },
  { key: "costOfEquityStable", label: "Cost of equity, after year 10", kind: "pct", group: "Risk", help: "" },
  { key: "fxReportingToTrading", label: "FX: reporting to trading currency", kind: "num", group: "Currency", help: "", advanced: true },
];

export const FIELDS: Record<ModelId, FieldMeta[]> = { fcff, excessReturn, reitDdm: reit };
