import { describe, expect, it } from "vitest";
import { computeHoldings, totals } from "../portfolio";
import { autoMap, normaliseSymbol, parseCsv, parseDate, toDrafts } from "../csvImport";
import type { Transaction } from "../types";

let id = 0;
const tx = (p: Partial<Transaction>): Transaction => ({
  id: String(id++), symbol: "AAPL", type: "buy", trade_date: "2025-01-01", quantity: 10, price: 100, currency: "USD", fx_to_sgd: 1.3, fees: 0, platform: "Tiger", ...p,
});

describe("holdings", () => {
  const market = { AAPL: { symbol: "AAPL", updatedAt: "", price: 150, prevClose: 140, currency: "USD" } };
  const fx = { USD: 1.35, SGD: 1 };
  it("weighted average cost across platforms, realized P&L on sells", () => {
    const hs = computeHoldings([
      tx({ quantity: 10, price: 100, fees: 1 }),
      tx({ quantity: 10, price: 120, platform: "Longbridge", trade_date: "2025-02-01", fx_to_sgd: 1.35 }),
      tx({ type: "sell", quantity: 5, price: 130, platform: "Tiger", trade_date: "2025-03-01", fx_to_sgd: 1.35 }),
      tx({ type: "dividend", quantity: 1, price: 2.5, trade_date: "2025-04-01" }),
    ], market, fx);
    const h = hs[0];
    expect(h.qty).toBe(15);
    const tiger = h.platforms.find((p) => p.platform === "Tiger")!;
    expect(tiger.avgCost).toBeCloseTo(100.1);
    expect(tiger.realized).toBeCloseTo(5 * 130 - 5 * 100.1);
    expect(h.avgCost).toBeCloseTo((5 * 100.1 + 1200) / 15);
    expect(h.dividends).toBeCloseTo(2.5);
    expect(h.valueSgd).toBeCloseTo(15 * 150 * 1.35);
    expect(h.dayChangeSgd).toBeCloseTo(15 * 10 * 1.35);
    // SGD cost uses FX at purchase
    expect(h.costSgd).toBeCloseTo(5 * 100.1 * 1.3 + 1200 * 1.35);
    expect(totals(hs).unrealizedSgd).toBeCloseTo(h.valueSgd - h.costSgd);
  });
  it("closing a position zeroes cost", () => {
    const [h] = computeHoldings([tx({}), tx({ type: "sell", quantity: 10, price: 90, trade_date: "2025-05-01" })], market, fx);
    expect(h.qty).toBe(0);
    expect(h.costSgd).toBe(0);
    expect(h.realized).toBeCloseTo(-100);
  });
});

describe("csv import", () => {
  it("detects columns after title lines and maps SGX/HK codes", () => {
    const csv = "Trade history export\nAccount 123\nTrade Time,Symbol,Market,Side,Filled Qty,Filled Price,Currency,Commission,Order ID\n" +
      "2025-03-04 10:00:01,D05,SG,Buy,100,38.50,SGD,4.1,A1\n04/03/2025,700,HK,SELL,200,\"410.2\",HKD,12,A2\n";
    const { headers, rows } = parseCsv(csv);
    const map = autoMap(headers);
    expect(map).toMatchObject({ date: "Trade Time", symbol: "Symbol", side: "Side", quantity: "Filled Qty", price: "Filled Price", fees: "Commission", currency: "Currency", market: "Market", orderId: "Order ID" });
    const d = toDrafts(rows, map, "Tiger");
    expect(d[0]).toMatchObject({ symbol: "D05.SI", type: "buy", quantity: 100, price: 38.5, fees: 4.1, trade_date: "2025-03-04", fx_to_sgd: 1 });
    expect(d[1]).toMatchObject({ symbol: "0700.HK", type: "sell", trade_date: "2025-03-04", import_ref: "Tiger:A2" });
    expect(d.every((x) => !x.error)).toBe(true);
  });
  it("parses dates and symbols", () => {
    expect(parseDate("2025/1/5")).toBe("2025-01-05");
    expect(normaliseSymbol("aapl", "US", "USD")).toBe("AAPL");
    expect(normaliseSymbol("C38U", undefined, "SGD")).toBe("C38U.SI");
  });
});
