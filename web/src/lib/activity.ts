// Client-side event calendar and "smart money" activity, built from market data.
import type { MarketData, MarketEvent } from "./types";
import { daysUntil } from "./format";

export interface CalendarItem extends MarketEvent {
  days: number;
  source: "market" | "macro" | "custom";
}

export function upcomingEvents(symbols: string[], market: Record<string, MarketData>, macro: MarketEvent[], custom: MarketEvent[], horizonDays = 45): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const s of symbols) for (const e of market[s]?.events ?? []) out.push({ ...e, symbol: s, days: daysUntil(e.date), source: "market" });
  for (const e of macro) out.push({ ...e, days: daysUntil(e.date), source: "macro" });
  for (const e of custom) out.push({ ...e, days: daysUntil(e.date), source: "custom" });
  return out.filter((e) => e.days >= 0 && e.days <= horizonDays).sort((a, b) => a.days - b.days);
}

export interface ActivityItem {
  date: string;
  symbol: string;
  kind: "insider" | "fund" | "move";
  text: string;
  value?: number;
  direction: "buy" | "sell" | "neutral";
}

export function activityFeed(symbols: string[], market: Record<string, MarketData>, lookbackDays = 60, minInsiderValue = 500_000): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const s of symbols) {
    const m = market[s];
    if (!m) continue;
    for (const t of m.insiders ?? []) {
      if (!t.date || -daysUntil(t.date) > lookbackDays || (t.value ?? 0) < minInsiderValue) continue;
      const txt = (t.text || "").toLowerCase();
      out.push({
        date: t.date,
        symbol: s,
        kind: "insider",
        value: t.value,
        direction: /sale|sell/.test(txt) ? "sell" : /purchase|buy/.test(txt) ? "buy" : "neutral",
        text: `${t.insider}${t.position ? ` (${t.position})` : ""}: ${t.text || "transaction"}`,
      });
    }
    for (const h of m.institutions ?? []) {
      if (h.pctChange == null || Math.abs(h.pctChange) < 0.2) continue;
      out.push({
        date: h.date,
        symbol: s,
        kind: "fund",
        value: h.value,
        direction: h.pctChange > 0 ? "buy" : "sell",
        text: `${h.holder} ${h.pctChange > 0 ? "added" : "cut"} ${Math.abs(h.pctChange * 100).toFixed(0)}% (13F, ${h.date})`,
      });
    }
    if (m.price && m.prevClose && Math.abs(m.price / m.prevClose - 1) >= 0.05) {
      const mv = m.price / m.prevClose - 1;
      out.push({ date: m.updatedAt?.slice(0, 10), symbol: s, kind: "move", direction: mv > 0 ? "buy" : "sell", text: `Moved ${(mv * 100).toFixed(1)}% on the last session` });
    }
  }
  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

export function headlines(symbols: string[], market: Record<string, MarketData>, limit = 20) {
  const seen = new Set<string>();
  const out: { symbol: string; title: string; publisher?: string; url?: string; time?: string }[] = [];
  for (const s of symbols)
    for (const n of market[s]?.news ?? []) {
      if (seen.has(n.title)) continue;
      seen.add(n.title);
      out.push({ symbol: s, ...n });
    }
  return out.sort((a, b) => (b.time ?? "").localeCompare(a.time ?? "")).slice(0, limit);
}
