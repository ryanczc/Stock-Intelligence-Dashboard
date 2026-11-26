// Decision review: how logged decisions played out, hit rates, and whether targets and DCF values run hot or cold.
import type { Decision, MarketData } from "./types";
import { daysUntil } from "./format";

export interface DecisionResult {
  d: Decision;
  days: number;
  priceNow: number | null;
  /** Return of the stock since the decision. For trims/sells/passes this is what you avoided (or missed). */
  move: number | null;
  /** Return credited to the decision: the move for buys/adds, minus the move for trims/sells/passes. */
  decisionReturn: number | null;
  annualised: number | null;
  targetHit: boolean | null;
  stopHit: boolean | null;
  expectedReturn: number | null; // target / entry - 1
  dcfUpside: number | null; // DCF value / entry - 1 at the time
  progressToTarget: number | null; // share of the expected move achieved so far
  benchmarkMove: number | null; // Nasdaq over the same period, when available
}

const isLong = (a: Decision["action"]) => a === "buy" || a === "add";

function closeOnOrAfter(series: [string, number][] | undefined, date: string): number | null {
  const p = series?.find((x) => x[0] >= date);
  return p ? p[1] : null;
}

export function evaluateDecision(d: Decision, md: MarketData | undefined, ndx?: [string, number][]): DecisionResult {
  const days = Math.max(0, -daysUntil(d.decision_date));
  const priceNow = md?.price ?? null;
  const move = priceNow && d.price > 0 ? priceNow / d.price - 1 : null;
  const decisionReturn = move == null ? null : isLong(d.action) ? move : -move;
  const years = days / 365;
  const annualised = decisionReturn != null && years >= 0.25 && 1 + decisionReturn > 0 ? Math.pow(1 + decisionReturn, 1 / years) - 1 : null;
  const since = (md?.history ?? []).filter((h) => h[0] >= d.decision_date).map((h) => h[1]);
  if (priceNow) since.push(priceNow);
  const hi = since.length ? Math.max(...since) : null;
  const lo = since.length ? Math.min(...since) : null;
  const targetHit = d.target_price && hi != null ? (isLong(d.action) ? hi >= d.target_price : (lo ?? Infinity) <= d.target_price) : null;
  const stopHit = d.stop_price && lo != null ? (isLong(d.action) ? lo <= d.stop_price : (hi ?? 0) >= d.stop_price) : null;
  const expectedReturn = d.target_price && d.price > 0 ? d.target_price / d.price - 1 : null;
  const dcfUpside = d.dcf_value && d.price > 0 ? d.dcf_value / d.price - 1 : null;
  const progressToTarget = move != null && expectedReturn ? move / expectedReturn : null;
  const b0 = closeOnOrAfter(ndx, d.decision_date);
  const b1 = ndx?.length ? ndx[ndx.length - 1][1] : null;
  const benchmarkMove = b0 && b1 && days > 0 ? b1 / b0 - 1 : null;
  return { d, days, priceNow, move, decisionReturn, annualised, targetHit, stopHit, expectedReturn, dcfUpside, progressToTarget, benchmarkMove };
}

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const median = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export interface ReviewSummary {
  count: number;
  matured: number; // decisions at least 90 days old
  hitRate: number | null; // share of matured decisions with a positive decision return
  avgReturn: number | null;
  beatBenchmark: number | null; // share of matured long decisions that beat the Nasdaq over the same period
  targetsHit: number | null; // share of matured decisions with a target that reached it
  stopsHit: number | null;
  /** Realised move / expected move, median over matured decisions with a target. < 1 = targets too optimistic so far. */
  targetCalibration: number | null;
  /** Realised move / DCF upside at the time, median over matured long decisions. */
  dcfCalibration: number | null;
  byConviction: { conviction: number; n: number; avgReturn: number | null }[];
}

export const MATURE_DAYS = 90;

export function summarise(rs: DecisionResult[]): ReviewSummary {
  const m = rs.filter((r) => r.days >= MATURE_DAYS && r.decisionReturn != null);
  const longs = m.filter((r) => isLong(r.d.action));
  const withTarget = m.filter((r) => r.targetHit != null);
  const withStop = m.filter((r) => r.stopHit != null);
  const share = (xs: DecisionResult[], f: (r: DecisionResult) => boolean) => (xs.length ? xs.filter(f).length / xs.length : null);
  // annualise both sides to the time elapsed vs the horizon so a 5-year target isn't judged after 3 months
  const targetCal = median(
    longs
      .filter((r) => r.expectedReturn && r.expectedReturn > 0 && r.move != null)
      .map((r) => {
        const horizonYears = (r.d.horizon_months ?? 60) / 12;
        const elapsed = Math.min(1, r.days / 365 / horizonYears);
        const expectedSoFar = Math.pow(1 + r.expectedReturn!, elapsed) - 1;
        return expectedSoFar > 0 ? r.move! / expectedSoFar : null;
      }),
  );
  const dcfCal = median(longs.filter((r) => r.dcfUpside && r.dcfUpside > 0 && r.move != null).map((r) => r.move! / r.dcfUpside!));
  const convictions = [1, 2, 3, 4, 5].map((c) => {
    const xs = m.filter((r) => r.d.conviction === c);
    return { conviction: c, n: xs.length, avgReturn: avg(xs.map((r) => r.decisionReturn)) };
  });
  return {
    count: rs.length,
    matured: m.length,
    hitRate: share(m, (r) => (r.decisionReturn ?? 0) > 0),
    avgReturn: avg(m.map((r) => r.decisionReturn)),
    beatBenchmark: share(longs.filter((r) => r.benchmarkMove != null), (r) => (r.move ?? 0) > (r.benchmarkMove ?? 0)),
    targetsHit: share(withTarget, (r) => !!r.targetHit),
    stopsHit: share(withStop, (r) => !!r.stopHit),
    targetCalibration: targetCal,
    dcfCalibration: dcfCal,
    byConviction: convictions.filter((c) => c.n > 0),
  };
}
