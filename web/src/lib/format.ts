const nf = (d: number) => new Intl.NumberFormat("en-SG", { minimumFractionDigits: d, maximumFractionDigits: d });

export function money(x: number | null | undefined, ccy?: string, digits?: number): string {
  if (x == null || !Number.isFinite(x)) return "–";
  const d = digits ?? (Math.abs(x) >= 1000 ? 0 : Math.abs(x) < 10 ? 2 : 2);
  return (ccy ? ccy + " " : "") + nf(d).format(x);
}

export function compact(x: number | null | undefined, ccy?: string): string {
  if (x == null || !Number.isFinite(x)) return "–";
  const a = Math.abs(x);
  const [v, s] = a >= 1e12 ? [x / 1e12, "T"] : a >= 1e9 ? [x / 1e9, "B"] : a >= 1e6 ? [x / 1e6, "M"] : a >= 1e3 ? [x / 1e3, "K"] : [x, ""];
  return (ccy ? ccy + " " : "") + nf(Math.abs(v) >= 100 ? 0 : 1).format(v) + s;
}

export function pct(x: number | null | undefined, digits = 1, sign = false): string {
  if (x == null || !Number.isFinite(x)) return "–";
  return (sign && x > 0 ? "+" : "") + nf(digits).format(x * 100) + "%";
}

export function num(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "–";
  return nf(digits).format(x);
}

export const tone = (x: number | null | undefined) => (x == null || !Number.isFinite(x) || x === 0 ? "" : x > 0 ? "pos" : "neg");

export function daysUntil(date: string, today = new Date()): number {
  const t = new Date(today.toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((new Date(date + "T00:00:00Z").getTime() - t) / 864e5);
}

export function ago(iso?: string | null): string {
  if (!iso) return "never";
  const m = (Date.now() - new Date(iso).getTime()) / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
