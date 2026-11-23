import { describe, expect, it } from "vitest";
import { beta, correlation, returns, stress, type HoldingRisk } from "../risk";
import { evaluateDecision, summarise } from "../review";
import { checkTripwire } from "../tripwires";
import type { Decision, MarketData } from "../types";

const weeks = (n: number, f: (i: number) => number): [string, number][] =>
  Array.from({ length: n }, (_, i) => [new Date(Date.UTC(2025, 0, 3 + 7 * i)).toISOString().slice(0, 10), f(i)]);

describe("risk maths", () => {
  const bench = weeks(60, () => 100);
  for (let i = 1; i < bench.length; i++) bench[i][1] = bench[i - 1][1] * (1 + 0.03 * Math.sin(i));
  const twice = bench.map(([d], i) => [d, i === 0 ? 100 : 0] as [string, number]);
  // build an asset with exactly 2x the benchmark's weekly returns
  for (let i = 1; i < bench.length; i++) twice[i][1] = twice[i - 1][1] * (1 + 2 * (bench[i][1] / bench[i - 1][1] - 1));
  it("beta and correlation", () => {
    expect(beta(returns(twice), returns(bench))).toBeCloseTo(2, 6);
    expect(correlation(returns(twice), returns(bench))).toBeCloseTo(1, 6);
  });
  it("stress takes the larger of the two factor moves, then FX", () => {
    const row = (over: Partial<HoldingRisk>): HoldingRisk => ({ symbol: "X", weight: 0.5, valueSgd: 1000, assetClass: "stock", sector: "", country: "", currency: "USD", vol: 0.3, betaNdx: 1.5, betaNdxSource: "", betaBtc: 0.5, betaBtcSource: "", ...over });
    const r = stress([row({}), row({ symbol: "SGX", currency: "SGD", betaNdx: 0, betaBtc: 0 })], { id: "t", label: "", ndx: -0.2, btc: -0.4, usdSgd: -0.1 });
    const x = r.lines.find((l) => l.symbol === "X")!;
    expect(x.local).toBeCloseTo(-0.3); // 1.5 x -20% beats 0.5 x -40%
    expect(x.total).toBeCloseTo(0.7 * 0.9 - 1);
    expect(r.lines.find((l) => l.symbol === "SGX")!.pnlSgd).toBe(0);
  });
});

describe("decision review", () => {
  const md = { symbol: "AAA", price: 150, history: weeks(30, (i) => 100 + i * 2) } as unknown as MarketData;
  const dec = (over: Partial<Decision>): Decision => ({ id: "1", symbol: "AAA", decision_date: "2025-01-03", action: "buy", price: 100, thesis: "t", target_price: 140, stop_price: 80, conviction: 4, horizon_months: 12, ...over });
  it("scores buys and sells", () => {
    const b = evaluateDecision(dec({}), md);
    expect(b.decisionReturn).toBeCloseTo(0.5);
    expect(b.targetHit).toBe(true);
    expect(b.stopHit).toBe(false);
    const s = evaluateDecision(dec({ action: "sell" }), md);
    expect(s.decisionReturn).toBeCloseTo(-0.5);
  });
  it("summarises", () => {
    const s = summarise([evaluateDecision(dec({}), md), evaluateDecision(dec({ id: "2", action: "sell" }), md)]);
    expect(s.hitRate).toBe(0.5);
    expect(s.byConviction[0]).toMatchObject({ conviction: 4, n: 2 });
  });
});

describe("tripwires", () => {
  it("checks price vs DCF and growth", () => {
    const md = { symbol: "AAA", price: 90, fundamentals: { revenueGrowthYoy: 0.1 } } as unknown as MarketData;
    expect(checkTripwire("AAA", { id: "a", metric: "priceToDcf", op: "<", value: 0.8 }, md, 100).breached).toBe(false);
    expect(checkTripwire("AAA", { id: "b", metric: "priceToDcf", op: ">", value: 0.85 }, md, 100).breached).toBe(true);
    expect(checkTripwire("AAA", { id: "c", metric: "revenueGrowth", op: "<", value: 0.15 }, md, null).breached).toBe(true);
    expect(checkTripwire("AAA", { id: "d", metric: "pe", op: ">", value: 30 }, md, null).value).toBeNull();
  });
});
