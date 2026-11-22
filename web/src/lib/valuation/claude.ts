// "Claude base case": researched default assumptions per ticker (web/src/data/claudeBaseCase.json).
// Layering: automatic data defaults -> Claude base case -> your own edits.
import raw from "../../data/claudeBaseCase.json";
import type { ScenarioName } from "../types";

export interface ClaudeCase {
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
}

type Raw = { asOf: string; symbols: Record<string, Omit<ClaudeCase, "asOf"> & { asOf?: string }> };
const file = raw as unknown as Raw;

export function claudeCase(symbol: string | undefined | null): ClaudeCase | null {
  if (!symbol) return null;
  const c = file.symbols[symbol] ?? file.symbols[symbol.toUpperCase()];
  return c ? { ...c, asOf: c.asOf ?? file.asOf } : null;
}
