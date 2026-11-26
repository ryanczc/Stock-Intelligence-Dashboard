// "Claude base case": researched default assumptions, thesis and change log per ticker,
// one file per ticker in web/src/data/research/<SYMBOL>.json (refreshed weekly by a Claude routine via pull request).
// Layering for valuation inputs: automatic data defaults -> Claude base case -> your own edits.
import type { ScenarioName } from "../types";

export interface ClaudeThesis {
  text: string;
  bull: string[];
  bear: string[];
  watch: string[];
}

export interface ClaudeCase {
  symbol: string;
  asOf: string;
  summary: string;
  noDcf?: boolean;
  industry?: string;
  model?: string;
  base?: Record<string, number>;
  bear?: Record<string, number>;
  bull?: Record<string, number>;
  probabilities?: Record<ScenarioName, number>;
  exitMetric?: string;
  exitMultiple?: number;
  rationale?: Record<string, string>;
  thesis?: ClaudeThesis;
  changes?: { date: string; text: string }[];
  sources?: { title: string; url: string }[];
}

const files = import.meta.glob<ClaudeCase>("../../data/research/*.json", { eager: true, import: "default" });
export const CLAUDE_CASES: Record<string, ClaudeCase> = Object.fromEntries(Object.values(files).map((c) => [c.symbol.toUpperCase(), c]));

export function claudeCase(symbol: string | undefined | null): ClaudeCase | null {
  if (!symbol) return null;
  return CLAUDE_CASES[symbol.toUpperCase()] ?? null;
}

/** Most recent change notes across the given symbols, newest first. */
export function recentClaudeChanges(symbols: string[], limit = 12) {
  const out: { symbol: string; date: string; text: string }[] = [];
  for (const s of symbols) for (const c of claudeCase(s)?.changes ?? []) out.push({ symbol: s, ...c });
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}
