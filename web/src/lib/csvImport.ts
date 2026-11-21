// Broker CSV import with automatic column detection. Each broker's export differs (and changes over
// time), so instead of hard-coding one layout we match header names against synonyms and let the user
// fix any column in the preview before importing.
import Papa from "papaparse";
import type { Transaction, TxType } from "./types";

export type Field = "symbol" | "side" | "quantity" | "price" | "date" | "fees" | "currency" | "market" | "amount" | "orderId";
export const FIELDS: { key: Field; label: string; required?: boolean }[] = [
  { key: "date", label: "Trade date", required: true },
  { key: "symbol", label: "Symbol / code", required: true },
  { key: "side", label: "Buy / sell", required: true },
  { key: "quantity", label: "Quantity", required: true },
  { key: "price", label: "Price", required: true },
  { key: "fees", label: "Fees / commission" },
  { key: "currency", label: "Currency" },
  { key: "market", label: "Market / exchange" },
  { key: "amount", label: "Amount (dividends)" },
  { key: "orderId", label: "Order / trade ID" },
];

const SYNONYMS: Record<Field, string[]> = {
  date: ["trade date", "trade time", "date", "time", "filled time", "transaction date", "settlement date", "order time", "execution time"],
  symbol: ["symbol", "ticker", "code", "stock code", "security code", "instrument", "stock"],
  side: ["side", "direction", "action", "buy/sell", "type", "transaction type", "trade type", "order side"],
  quantity: ["quantity", "qty", "filled qty", "filled quantity", "shares", "units", "volume", "executed qty"],
  price: ["price", "filled price", "avg price", "average price", "trade price", "executed price", "unit price", "avg. price"],
  fees: ["fees", "fee", "commission", "total fees", "charges", "commission & fees", "transaction fee", "total charges"],
  currency: ["currency", "ccy", "trade currency", "settlement currency"],
  market: ["market", "exchange", "region"],
  amount: ["amount", "net amount", "total amount", "value", "gross amount", "proceeds"],
  orderId: ["order id", "order no", "order no.", "trade id", "transaction id", "reference", "ref"],
};

export const PRESETS: Record<string, string> = {
  Auto: "Detect columns from the header row",
  Tiger: "Tiger Brokers: Statements > Trade history > Export",
  Syfe: "Syfe: Activity > Download transactions",
  Longbridge: "Longbridge: Account > Statements > Order history export",
};

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  // Some broker exports have title lines before the header: find the first line that looks like a header.
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let start = 0;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const l = lines[i].toLowerCase();
    const hits = Object.values(SYNONYMS).filter((syns) => syns.some((s) => l.includes(s))).length;
    if (hits >= 3) {
      start = i;
      break;
    }
  }
  const res = Papa.parse<Record<string, string>>(lines.slice(start).join("\n"), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  return { headers: res.meta.fields ?? [], rows: res.data };
}

export function autoMap(headers: string[]): Partial<Record<Field, string>> {
  const map: Partial<Record<Field, string>> = {};
  const used = new Set<string>();
  const norm = (h: string) => h.toLowerCase().replace(/[_\s]+/g, " ").replace(/\(.*?\)/g, "").trim();
  // exact matches first, then "contains" matches
  for (const pass of ["exact", "contains"] as const) {
    for (const f of Object.keys(SYNONYMS) as Field[]) {
      if (map[f]) continue;
      for (const syn of SYNONYMS[f]) {
        const h = headers.find((h) => !used.has(h) && (pass === "exact" ? norm(h) === syn : norm(h).includes(syn)));
        if (h) {
          map[f] = h;
          used.add(h);
          break;
        }
      }
    }
  }
  return map;
}

const num = (s: string | undefined) => {
  if (s == null) return NaN;
  const cleaned = String(s).replace(/[,$\s]|SGD|USD|HKD/gi, "").replace(/^\((.*)\)$/, "-$1");
  return cleaned === "" ? NaN : Number(cleaned);
};

export function parseDate(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); // assume day-first (Singapore)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function parseSide(s: string | undefined, qty: number): TxType | null {
  const v = (s ?? "").toLowerCase();
  if (/div/.test(v)) return "dividend";
  if (/fee|charge|commission/.test(v) && !/buy|sell/.test(v)) return "fee";
  if (/sell|sld|^s$|short/.test(v)) return "sell";
  if (/buy|bot|^b$|purchase|subscri/.test(v)) return "buy";
  if (!v && Number.isFinite(qty)) return qty < 0 ? "sell" : "buy";
  return null;
}

/** Normalise broker codes to Yahoo symbols: D05 (SG) -> D05.SI, 700 (HK) -> 0700.HK. */
export function normaliseSymbol(raw: string, market?: string, currency?: string): string {
  let s = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (/\.(SI|HK|SS|SZ|T|L|AX)$/.test(s) || /-USD$/.test(s)) return s;
  s = s.replace(/^(SGX|HKEX|HK|SG|US|NASDAQ|NYSE):/, "");
  const mk = (market ?? "").toUpperCase();
  const isHK = /HK/.test(mk) || (currency === "HKD" && !mk);
  const isSG = /SG|SGX|SES/.test(mk) || (currency === "SGD" && !mk);
  if (isHK && /^\d+$/.test(s)) return s.padStart(4, "0") + ".HK";
  if (isSG) return s + ".SI";
  return s;
}

export interface Draft extends Omit<Transaction, "id"> {
  error?: string;
}

export function toDrafts(rows: Record<string, string>[], map: Partial<Record<Field, string>>, platform: string, defaultCurrency = "USD"): Draft[] {
  return rows.map((r, i) => {
    const get = (f: Field) => (map[f] ? r[map[f]!] : undefined);
    const qtyRaw = num(get("quantity"));
    const type = parseSide(get("side"), qtyRaw);
    const currency = (get("currency") || defaultCurrency).trim().toUpperCase();
    const symbol = normaliseSymbol(get("symbol") ?? "", get("market"), currency);
    const date = parseDate(get("date"));
    let quantity = Math.abs(qtyRaw);
    let price = num(get("price"));
    if (type === "dividend" || type === "fee") {
      const amt = Math.abs(num(get("amount")));
      if (Number.isFinite(amt)) {
        quantity = 1;
        price = amt;
      }
    }
    const fees = Math.abs(num(get("fees"))) || 0;
    const errors: string[] = [];
    if (!symbol) errors.push("no symbol");
    if (!date) errors.push("bad date");
    if (!type) errors.push(`unknown side "${get("side") ?? ""}"`);
    if (!Number.isFinite(quantity) || quantity <= 0) errors.push("bad quantity");
    if (!Number.isFinite(price) || price < 0) errors.push("bad price");
    const ref = get("orderId") || `${platform}|${date}|${symbol}|${type}|${quantity}|${price}|${i}`;
    return {
      symbol,
      type: (type ?? "buy") as TxType,
      trade_date: date ?? "",
      quantity,
      price,
      currency,
      fx_to_sgd: currency === "SGD" ? 1 : null,
      fees,
      platform,
      note: "CSV import",
      import_ref: `${platform}:${ref}`,
      error: errors.length ? errors.join(", ") : undefined,
    };
  });
}
