// Damodaran-style cost of capital: bottom-up beta, ERP + country risk premium, synthetic rating for cost of debt.

/** Damodaran's interest-coverage -> default spread table for large non-financial firms (approximate, Jan 2025). */
export const SYNTHETIC_RATINGS: { minCoverage: number; rating: string; spread: number }[] = [
  { minCoverage: 8.5, rating: "AAA", spread: 0.0059 },
  { minCoverage: 6.5, rating: "AA", spread: 0.007 },
  { minCoverage: 5.5, rating: "A+", spread: 0.0092 },
  { minCoverage: 4.25, rating: "A", spread: 0.0107 },
  { minCoverage: 3.0, rating: "A-", spread: 0.0121 },
  { minCoverage: 2.5, rating: "BBB", spread: 0.0147 },
  { minCoverage: 2.25, rating: "BB+", spread: 0.0183 },
  { minCoverage: 2.0, rating: "BB", spread: 0.022 },
  { minCoverage: 1.75, rating: "B+", spread: 0.0298 },
  { minCoverage: 1.5, rating: "B", spread: 0.0367 },
  { minCoverage: 1.25, rating: "B-", spread: 0.0456 },
  { minCoverage: 0.8, rating: "CCC", spread: 0.0604 },
  { minCoverage: 0.65, rating: "CC", spread: 0.0889 },
  { minCoverage: 0.2, rating: "C", spread: 0.1173 },
  { minCoverage: -Infinity, rating: "D", spread: 0.1574 },
];

export function syntheticRating(ebit: number | null | undefined, interest: number | null | undefined) {
  if (!interest || interest <= 0) return SYNTHETIC_RATINGS[0];
  const cov = (ebit ?? 0) / Math.abs(interest);
  return SYNTHETIC_RATINGS.find((r) => cov >= r.minCoverage) ?? SYNTHETIC_RATINGS[SYNTHETIC_RATINGS.length - 1];
}

export interface CostOfCapitalInputs {
  riskFree: number;
  erp: number; // mature market ERP
  crp: number; // country risk premium
  unleveredBeta: number;
  marketCap: number;
  debt: number;
  taxRate: number; // marginal
  defaultSpread: number;
}

export function costOfCapital(i: CostOfCapitalInputs) {
  const de = i.marketCap > 0 ? i.debt / i.marketCap : 0;
  const leveredBeta = i.unleveredBeta * (1 + (1 - i.taxRate) * de);
  const costOfEquity = i.riskFree + leveredBeta * (i.erp + i.crp);
  const preTaxCostOfDebt = i.riskFree + i.defaultSpread;
  const afterTaxCostOfDebt = preTaxCostOfDebt * (1 - i.taxRate);
  const v = i.marketCap + i.debt;
  const we = v > 0 ? i.marketCap / v : 1;
  const wacc = we * costOfEquity + (1 - we) * afterTaxCostOfDebt;
  // Stable state: beta drifts to 1, same capital structure.
  const stableCostOfEquity = i.riskFree + 1 * (i.erp + i.crp);
  const stableWacc = we * stableCostOfEquity + (1 - we) * afterTaxCostOfDebt;
  return { leveredBeta, costOfEquity, preTaxCostOfDebt, afterTaxCostOfDebt, debtWeight: 1 - we, wacc, stableCostOfEquity, stableWacc };
}
