import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fcffModel, excessReturnModel, reitModel, growthPath, valueSymbol, cagr, detectDrift } from "../valuation";
import type { MarketData, ReferenceData } from "../types";

const snap = JSON.parse(readFileSync(new URL("../../../public/demo/snapshot.json", import.meta.url), "utf8")) as {
  market: MarketData[];
  fx: Record<string, number>;
  reference: ReferenceData;
};
const md = (s: string) => snap.market.find((m) => m.symbol === s)!;

describe("growth path", () => {
  it("holds for 5 years then fades linearly to stable", () => {
    const g = growthPath(0.2, 0.04);
    expect(g.slice(0, 5)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(g[5]).toBeCloseTo(0.168);
    expect(g[9]).toBeCloseTo(0.04);
  });
});

describe("FCFF model", () => {
  const base = {
    revenue: 1000, growthHigh: 0.1, stableGrowth: 0.03, currentMargin: 0.2, targetMargin: 0.2, marginConvergenceYear: 5,
    taxEffective: 0.25, taxMarginal: 0.25, salesToCapital: 2, waccInitial: 0.09, waccStable: 0.08, terminalRoic: 0.08,
    cash: 100, debt: 200, minorityInterest: 0, nonOperatingAssets: 0, shares: 100, interestExpense: 10, daPctRevenue: 0.05,
    dps0: 0, failureProbability: 0, distressProceeds: 0.5, fxReportingToTrading: 1,
  };
  it("matches a hand-checked year 1", () => {
    const r = fcffModel(base);
    const y1 = r.years[0];
    expect(y1.revenue).toBeCloseTo(1100);
    expect(y1.ebit).toBeCloseTo(220);
    expect(y1.cashFlow).toBeCloseTo(220 * 0.75 - 100 / 2);
    expect(y1.pv).toBeCloseTo((165 - 50) / 1.09);
  });
  it("terminal value uses g/ROIC reinvestment and a Gordon growth formula", () => {
    const r = fcffModel(base);
    const rev10 = r.years[9].revenue as number;
    const fcff11 = rev10 * 1.03 * 0.2 * 0.75 * (1 - 0.03 / 0.08);
    expect(r.terminal.value).toBeCloseTo(fcff11 / (0.08 - 0.03), 4);
  });
  it("higher growth with ROIC = WACC in terminal adds value only through years 1-10", () => {
    expect(fcffModel({ ...base, growthHigh: 0.15 }).valuePerShare).toBeGreaterThan(fcffModel(base).valuePerShare);
  });
  it("failure probability lowers value", () => {
    expect(fcffModel({ ...base, failureProbability: 0.2 }).valuePerShare).toBeLessThan(fcffModel(base).valuePerShare);
  });
  it("converts per-share value to trading currency", () => {
    expect(fcffModel({ ...base, fxReportingToTrading: 2 }).valuePerShare).toBeCloseTo(fcffModel(base).valuePerShare * 2);
  });
});

describe("excess return and REIT models", () => {
  it("ROE equal to cost of equity is worth book value", () => {
    const r = excessReturnModel({ bookValuePerShare: 20, roeCurrent: 0.1, roeStable: 0.1, costOfEquity: 0.1, costOfEquityStable: 0.1, payoutRatio: 0.5, stableGrowth: 0.03, shares: 1, fxReportingToTrading: 1 });
    expect(r.valuePerShare).toBeCloseTo(20, 6);
  });
  it("REIT with no growth is a perpetuity of distributions", () => {
    const r = reitModel({ ffoPerShare: 1, growthHigh: 0, stableGrowth: 0, payoutRatio: 1, costOfEquity: 0.08, costOfEquityStable: 0.08, fxReportingToTrading: 1 });
    expect(r.valuePerShare).toBeCloseTo(1 / 0.08, 6);
  });
});

describe("full valuations on live snapshot", () => {
  for (const s of ["AAPL", "MSFT", "NVDA", "D05.SI", "C38U.SI", "0700.HK"]) {
    it(`${s} produces a finite value, target and CAGR`, () => {
      const v = valueSymbol(md(s), snap.reference, snap.fx, undefined);
      expect(v?.kind).toBe("model");
      if (v?.kind !== "model") return;
      expect(Number.isFinite(v.weightedValue)).toBe(true);
      expect(v.results.bear.valuePerShare).toBeLessThan(v.results.bull.valuePerShare);
      expect(Number.isFinite(v.exit.priceTarget)).toBe(true);
      console.log(s, v.model, "price", v.price?.toFixed(2), "dcf", v.weightedValue.toFixed(2), "bear/base/bull",
        [v.results.bear, v.results.base, v.results.bull].map((r) => r.valuePerShare.toFixed(2)).join("/"),
        "exit", v.exit.metric, v.exit.multiple.toFixed(1), v.exit.candidates.map((c) => `${c.source}:${c.multiple.toFixed(1)}`).join("; "),
        "PT", v.exit.priceTarget.toFixed(2), "CAGR", ((v.exit.cagr ?? NaN) * 100).toFixed(1) + "%");
    });
  }
  it("crypto uses the user's target", () => {
    const v = valueSymbol(md("BTC-USD"), snap.reference, snap.fx, undefined, [], { symbol: "BTC-USD", extra: { targetPrice5y: 115325 } });
    expect(v?.kind).toBe("target");
    if (v?.kind === "target") expect(v.cagr).toBeCloseTo(Math.pow(115325 / md("BTC-USD").price!, 0.2) - 1, 6);
  });
});

describe("cagr and drift", () => {
  it("includes dividends", () => {
    expect(cagr(100, 150, 10)).toBeCloseTo(Math.pow(1.6, 0.2) - 1);
  });
  it("flags an edited field whose default moved", () => {
    const flags = detectDrift({ growthHigh: 0.12, targetMargin: 0.3 }, {
      overrides: { base: { growthHigh: 0.2, targetMargin: 0.35 } }, probabilities: { bear: 0.25, base: 0.5, bull: 0.25 },
      baselineAtEdit: { growthHigh: 0.08, targetMargin: 0.3 },
    });
    expect(flags.map((f) => f.field)).toEqual(["growthHigh"]);
  });
});
