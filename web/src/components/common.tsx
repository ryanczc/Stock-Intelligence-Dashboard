import { Link } from "react-router-dom";
import type { SimpleTarget, Valuation } from "../lib/valuation";
import { money, pct, tone } from "../lib/format";

export function Sparkline({ points, width = 90, height = 26 }: { points?: [string, number][]; width?: number; height?: number }) {
  const ys = (points ?? []).slice(-52).map((p) => p[1]);
  if (ys.length < 2) return null;
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const x = (i: number) => (i / (ys.length - 1)) * width;
  const y = (v: number) => height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
  const d = ys.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const up = ys[ys.length - 1] >= ys[0];
  return (
    <svg className="spark" width={width} height={height} aria-hidden>
      <path d={d} fill="none" stroke={up ? "var(--pos)" : "var(--neg)"} strokeWidth="1.5" />
    </svg>
  );
}

export function Kpi({ label, value, sub, subTone }: { label: string; value: string; sub?: string; subTone?: number | null }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className={`sub ${tone(subTone)}`}>{sub}</div>}
    </div>
  );
}

export function SymbolCell({ symbol, name, extra }: { symbol: string; name?: string; extra?: React.ReactNode }) {
  return (
    <td className="sym">
      <Link to={`/s/${encodeURIComponent(symbol)}`}>
        <b>{symbol}</b>
      </Link>
      <span className="small muted">{name}</span>
      {extra}
    </td>
  );
}

/** Intrinsic value, 5y target and CAGR columns, shared by Holdings and Watchlist. */
export function valuationCells(v: Valuation | SimpleTarget | null, ccy: string) {
  if (!v) return { dcf: "–", upside: null as number | null, priceToDcf: null as number | null, target: "–", cagr: null as number | null, flag: false };
  if (v.kind === "target") return { dcf: "n/a", upside: null, priceToDcf: null, target: v.targetPrice5y ? money(v.targetPrice5y, undefined) : "set", cagr: v.cagr, flag: false };
  const priceToDcf = v.price && v.weightedValue > 0 ? v.price / v.weightedValue : null;
  return { dcf: money(v.weightedValue), upside: v.upside, priceToDcf, target: money(v.exit.priceTarget), cagr: v.exit.cagr, flag: v.drift.length > 0, ccy };
}

export function Pct({ x, sign = true }: { x: number | null | undefined; sign?: boolean }) {
  return <span className={tone(x)}>{pct(x, 1, sign)}</span>;
}

/** Price as a % of DCF value: green below 100% (trading under intrinsic value), red above. */
export function PriceToDcf({ x }: { x: number | null | undefined }) {
  if (x == null || !Number.isFinite(x)) return <span className="muted">–</span>;
  return <span className={x < 1 ? "pos" : "neg"}>{pct(x, 0)}</span>;
}
