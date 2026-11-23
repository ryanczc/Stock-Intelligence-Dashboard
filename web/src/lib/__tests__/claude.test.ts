import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CLAUDE_CASES, claudeCase, valueSymbol, type Valuation } from "../valuation";
import { FIELDS } from "../valuation/fields";
import type { MarketData, ReferenceData } from "../types";

const snap = JSON.parse(readFileSync(new URL("../../../public/demo/snapshot.json", import.meta.url), "utf8")) as {
  market: MarketData[];
  fx: Record<string, number>;
  reference: ReferenceData;
};
const md = (s: string) => snap.market.find((m) => m.symbol === s);
const symbols = Object.keys(CLAUDE_CASES);

describe("Claude base case", () => {
  it("loads one research file per ticker with a thesis and change log", () => {
    expect(symbols.length).toBeGreaterThanOrEqual(10);
    for (const s of symbols) {
      const c = claudeCase(s)!;
      expect(c.asOf, s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.thesis?.text, s).toBeTruthy();
      expect(c.changes?.length, s).toBeGreaterThan(0);
    }
  });

  it("only uses input names the models know", () => {
    const known = new Set(Object.values(FIELDS).flat().map((f) => f.key));
    for (const s of symbols) {
      const c = claudeCase(s)!;
      for (const k of ["base", "bear", "bull"] as const) for (const key of Object.keys(c[k] ?? {})) expect(known.has(key), `${s}.${k}.${key}`).toBe(true);
    }
  });

  it("layers between data defaults and user edits", () => {
    const v = valueSymbol(md("NOW"), snap.reference, snap.fx, undefined, [], undefined, claudeCase("NOW")) as Valuation;
    expect(v.inputs.base.growthHigh).toBe(0.18);
    expect(v.exit.multiple).toBe(35);
    expect(v.exit.multipleSource).toMatch(/Claude/);
    expect(v.exit.netIncomeYear5).toBeGreaterThan(0);
    const mine = valueSymbol(md("NOW"), snap.reference, snap.fx, { overrides: { base: { growthHigh: 0.1 } }, probabilities: { bear: 0.25, base: 0.5, bull: 0.25 }, exitMultiple: 30 }, [], undefined, claudeCase("NOW")) as Valuation;
    expect(mine.inputs.base.growthHigh).toBe(0.1);
    expect(mine.inputs.base.targetMargin).toBe(0.28); // untouched Claude value still applies
    expect(mine.exit.multiple).toBe(30);
    expect(mine.exit.multipleSource).toBe("Your multiple");
  });

  it("gives every covered ticker a finite value and target", () => {
    const rows: string[] = [];
    for (const s of symbols) {
      const m = md(s);
      if (!m) continue;
      const v = valueSymbol(m, snap.reference, snap.fx, undefined, [], undefined, claudeCase(s));
      if (claudeCase(s)!.noDcf) {
        expect(v?.kind).toBe("target");
        continue;
      }
      expect(v?.kind).toBe("model");
      const val = v as Valuation;
      expect(Number.isFinite(val.weightedValue)).toBe(true);
      expect(Number.isFinite(val.exit.priceTarget)).toBe(true);
      rows.push(`${s.padEnd(8)} price ${m.price?.toFixed(2)} dcf ${val.weightedValue.toFixed(2)} target ${val.exit.priceTarget.toFixed(2)} cagr ${((val.exit.cagr ?? NaN) * 100).toFixed(1)}%`);
    }
    console.log(rows.join("\n"));
  });
});

describe("year-by-year edits", () => {
  it("override growth, margin and WACC for single years and move the value", () => {
    const base = valueSymbol(md("NOW"), snap.reference, snap.fx, undefined, [], undefined, claudeCase("NOW")) as Valuation;
    const edited = valueSymbol(md("NOW"), snap.reference, snap.fx, { overrides: { base: { g1: 0.3, m5: 0.4, w1: 0.07 } }, probabilities: { bear: 0.25, base: 0.5, bull: 0.25 } }, [], undefined, claudeCase("NOW")) as Valuation;
    const y = edited.results.base.years;
    expect(y[0].growth).toBe(0.3);
    expect(y[1].growth).toBe(base.results.base.years[1].growth);
    expect(y[4].margin).toBe(0.4);
    expect(y[0].discountRate).toBe(0.07);
    expect(edited.results.base.valuePerShare).toBeGreaterThan(base.results.base.valuePerShare);
    // bear/bull keep their own paths
    expect(edited.results.bear.years[0].growth).toBe(base.results.bear.years[0].growth);
  });
});
