import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../data/AppContext";
import { Kpi } from "../components/common";
import { SCENARIOS, correlationMatrix, exposureBy, holdingRisks, stress, type HoldingRisk } from "../lib/risk";
import { money, num, pct, tone } from "../lib/format";

const sgd = (x: number) => `${x < 0 ? "-" : ""}S$${money(Math.abs(x), undefined, 0)}`;

function Bars({ title, rows }: { title: string; rows: { key: string; valueSgd: number; pct: number }[] }) {
  return (
    <div>
      <h3>{title}</h3>
      {rows.map((r) => (
        <div className="alloc" key={r.key}>
          <span title={r.key}>{r.key}</span>
          <div className="bar"><div style={{ width: `${(r.pct * 100).toFixed(1)}%` }} /></div>
          <span className="num small">{pct(r.pct, 0)}</span>
        </div>
      ))}
    </div>
  );
}

function corrColor(c: number | null) {
  if (c == null) return "transparent";
  const a = Math.min(1, Math.abs(c));
  return c >= 0 ? `rgba(220, 70, 60, ${0.08 + a * 0.55})` : `rgba(40, 140, 90, ${0.08 + a * 0.55})`;
}

export default function Risk() {
  const { data, holdings } = useApp();
  const d = data!;
  const rows = useMemo(() => holdingRisks(holdings, d.market, d.benchmarks), [holdings, d]);
  const [scn, setScn] = useState(SCENARIOS[3].id);
  const [showAll, setShowAll] = useState(false);
  if (!rows.length) return <div className="card empty">Add holdings to see portfolio risk.</div>;

  const total = rows.reduce((s, r) => s + r.valueSgd, 0);
  const betaNdx = rows.reduce((s, r) => s + r.weight * r.betaNdx, 0);
  const betaBtc = rows.reduce((s, r) => s + r.weight * r.betaBtc, 0);
  const results = SCENARIOS.map((s) => ({ s, r: stress(rows, s) }));
  const active = results.find((x) => x.s.id === scn)!;
  const usd = rows.filter((r) => r.currency === "USD" || r.currency === "HKD").reduce((s, r) => s + r.weight, 0);
  const top = [...rows].sort((a, b) => b.valueSgd - a.valueSgd);
  const corrSyms = (showAll ? top : top.slice(0, 12)).filter((r) => r.assetClass !== "cash" && r.assetClass !== "bond").map((r) => r.symbol);
  const matrix = correlationMatrix(corrSyms, d.market);
  // average pairwise correlation, value-weighted: a quick "how diversified am I really" number
  let wsum = 0;
  let csum = 0;
  corrSyms.forEach((a, i) => corrSyms.forEach((b, j) => {
    if (j <= i || matrix[i][j] == null) return;
    const w = (rows.find((r) => r.symbol === a)!.weight) * (rows.find((r) => r.symbol === b)!.weight);
    wsum += w;
    csum += w * matrix[i][j]!;
  }));
  const avgCorr = wsum ? csum / wsum : null;
  const assumed = rows.filter((r) => r.betaNdxSource.startsWith("assumed") || r.betaBtcSource.startsWith("assumed"));

  return (
    <div className="stack">
      <div className="grid kpis">
        <Kpi label="Beta-adjusted Nasdaq exposure" value={`${num(betaNdx, 2)}x`} sub={`S$${money(total * betaNdx, undefined, 0)} of Nasdaq-equivalent risk`} />
        <Kpi label="Bitcoin sensitivity" value={`${num(betaBtc, 2)}x`} sub={`S$${money(total * betaBtc, undefined, 0)} moves like bitcoin`} />
        <Kpi label="US dollar exposure" value={pct(usd, 0)} sub="USD and HKD assets (HKD is pegged)" />
        <Kpi label="Average correlation" value={num(avgCorr, 2)} sub="value-weighted, weekly returns over 2 years" />
      </div>

      <div className="card">
        <div className="row between">
          <h2>Stress tests</h2>
          <span className="small muted">Estimated hit to today's S${money(total, undefined, 0)}</span>
        </div>
        <div className="grid kpis" style={{ marginTop: 8 }}>
          {results.map(({ s, r }) => (
            <button key={s.id} className={`card kpi ${scn === s.id ? "selected" : ""}`} onClick={() => setScn(s.id)} style={{ textAlign: "left" }}>
              <div className="label">{s.label}</div>
              <div className={`value ${tone(r.pnlSgd)}`}>{sgd(r.pnlSgd)}</div>
              <div className={`sub ${tone(r.pct)}`}>{pct(r.pct, 1, true)} of portfolio</div>
            </button>
          ))}
        </div>
        <h3 style={{ marginTop: 12 }}>{active.s.label}: by holding</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Holding</th><th className="num">Price move</th><th className="num">Currency move</th><th className="num">Total</th><th className="num">S$ impact</th></tr></thead>
            <tbody>
              {active.r.lines.map((l) => (
                <tr key={l.symbol}>
                  <td><Link to={`/s/${encodeURIComponent(l.symbol)}`}><b>{l.symbol}</b></Link></td>
                  <td className={`num ${tone(l.local)}`}>{pct(l.local, 1, true)}</td>
                  <td className={`num ${tone(l.fx)}`}>{pct(l.fx, 1, true)}</td>
                  <td className={`num ${tone(l.total)}`}>{pct(l.total, 1, true)}</td>
                  <td className={`num ${tone(l.pnlSgd)}`}>{money(l.pnlSgd, undefined, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Each holding moves by its beta to the Nasdaq or to bitcoin, whichever gives the bigger move (so stocks like MSTR that track both aren't counted twice),
          then by the currency move in SGD. Betas are from 2 years of weekly prices with weekly moves capped at ±35% and betas capped at 3, so one-off spikes don't dominate.
          History doesn't guarantee the future, and correlations rise in a crash.
        </p>
      </div>

      <div className="card">
        <h2>Exposure</h2>
        <div className="grid two">
          <Bars title="By asset class" rows={exposureBy(rows, (r) => r.assetClass)} />
          <Bars title="By sector" rows={exposureBy(rows, (r) => r.sector)} />
          <Bars title="By country" rows={exposureBy(rows, (r) => r.country)} />
          <Bars title="By currency" rows={exposureBy(rows, (r) => r.currency)} />
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <h2>Correlation between holdings</h2>
          {top.length > 12 && <button className="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? "Top 12 only" : `Show all ${top.length}`}</button>}
        </div>
        <div className="table-wrap">
          <table className="corr">
            <thead><tr><th />{corrSyms.map((s) => <th key={s} className="num small">{s.replace("-USD", "")}</th>)}</tr></thead>
            <tbody>
              {corrSyms.map((a, i) => (
                <tr key={a}>
                  <td className="small"><b>{a.replace("-USD", "")}</b></td>
                  {corrSyms.map((b, j) => (
                    <td key={b} className="num small" style={{ background: i === j ? "var(--panel-2)" : corrColor(matrix[i][j]) }}>
                      {i === j ? "" : matrix[i][j] == null ? "–" : matrix[i][j]!.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">1.00 = move together, 0 = unrelated, negative = move in opposite directions. Red cells are pairs that will tend to fall together.</p>
      </div>

      <div className="card">
        <h2>Risk by holding</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Holding</th><th className="num">Weight</th><th className="num">Volatility (yr)</th><th className="num">Beta: Nasdaq</th><th className="num">Beta: bitcoin</th><th className="num">Risk contribution</th></tr></thead>
            <tbody>
              {top.map((r: HoldingRisk) => (
                <tr key={r.symbol}>
                  <td><Link to={`/s/${encodeURIComponent(r.symbol)}`}><b>{r.symbol}</b></Link></td>
                  <td className="num">{pct(r.weight, 1)}</td>
                  <td className="num">{pct(r.vol, 0)}</td>
                  <td className="num" title={r.betaNdxSource}>{num(r.betaNdx, 2)}{r.betaNdxSource.startsWith("assumed") ? "*" : ""}</td>
                  <td className="num" title={r.betaBtcSource}>{num(r.betaBtc, 2)}{r.betaBtcSource.startsWith("assumed") ? "*" : ""}</td>
                  <td className="num">{pct(betaNdx ? (r.weight * r.betaNdx) / betaNdx : null, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Risk contribution: share of the portfolio's Nasdaq beta coming from each holding. Hover a beta to see how it was measured.
          {assumed.length > 0 && ` * Assumed for ${assumed.map((r) => r.symbol).join(", ")} (under 20 weeks of shared history).`}
        </p>
      </div>
    </div>
  );
}
