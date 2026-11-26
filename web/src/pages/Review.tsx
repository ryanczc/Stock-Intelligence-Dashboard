import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../data/AppContext";
import { Kpi } from "../components/common";
import { MissingTableBanner, OUTCOMES } from "../components/PmPanels";
import { MATURE_DAYS, evaluateDecision, summarise } from "../lib/review";
import { money, pct, tone } from "../lib/format";

const calText = (x: number | null, what: string) => {
  if (x == null) return `Not enough matured decisions yet (needs ${what} at least ${MATURE_DAYS} days old).`;
  if (x < 0) return `Running hot: so far prices have moved against your expected direction (${pct(x, 0)} of the expected move). Check whether the thesis or the assumptions were too optimistic.`;
  if (x < 0.8) return `Running hot: so far prices have moved only ${pct(x, 0)} of the way you expected. Consider trimming growth or exit multiples.`;
  if (x > 1.2) return `Running cold: prices have moved ${pct(x, 0)} of what you expected, more than planned. You may be too conservative.`;
  return `About right: realised moves are ${pct(x, 0)} of what you expected.`;
};

export default function Review() {
  const { data } = useApp();
  const d = data!;
  const [filter, setFilter] = useState<"all" | "open" | "reviewed" | "unreviewed">("all");
  const results = useMemo(() => d.decisions.map((x) => evaluateDecision(x, d.market[x.symbol], d.benchmarks.NDX)).sort((a, b) => b.d.decision_date.localeCompare(a.d.decision_date)), [d]);
  const s = summarise(results);
  const shown = results.filter((r) => filter === "all" || (filter === "reviewed" ? !!r.d.review : filter === "unreviewed" ? !r.d.review && r.days >= MATURE_DAYS : r.d.action === "buy" || r.d.action === "add"));
  const outcomes = Object.keys(OUTCOMES).map((k) => ({ k, n: d.decisions.filter((x) => x.outcome === k).length }));

  if (d.missingTables.includes("decisions")) return <MissingTableBanner />;
  if (!d.decisions.length)
    return (
      <div className="card empty stack">
        <h2>Decision review</h2>
        <p>
          No decisions logged yet. Open any stock, click the <b>Decisions</b> tab and log why you're buying, trimming or passing, with a target, stop and conviction.
          This page then scores how those calls played out.
        </p>
      </div>
    );

  return (
    <div className="stack">
      <div className="grid kpis">
        <Kpi label="Hit rate" value={pct(s.hitRate, 0)} sub={`${s.matured} of ${s.count} decisions are ${MATURE_DAYS}+ days old`} />
        <Kpi label="Average decision return" value={pct(s.avgReturn, 1, true)} sub="buys: gain since; sells/passes: move avoided" subTone={s.avgReturn} />
        <Kpi label="Beat the Nasdaq" value={pct(s.beatBenchmark, 0)} sub="share of buys ahead of the Nasdaq 100 since" />
        <Kpi label="Targets hit · stops hit" value={`${pct(s.targetsHit, 0)} · ${pct(s.stopsHit, 0)}`} sub="of matured decisions with one set" />
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Are your targets too high or too low?</h2>
          <p><b>Price targets:</b> {calText(s.targetCalibration, "buys with a target")}</p>
          <p><b>DCF values:</b> {calText(s.dcfCalibration, "buys logged with a DCF value")}</p>
          <p className="small muted">
            Targets: the realised move compared with the part of the target's move you'd expect by now (pro-rated over your horizon). DCF: the realised move compared
            with the DCF upside when you logged the decision. Both are medians; they get meaningful after 10+ decisions.
          </p>
        </div>
        <div className="card">
          <h2>Conviction vs results</h2>
          {!s.byConviction.length ? <div className="empty">Needs matured decisions.</div> : (
            <table>
              <thead><tr><th>Conviction</th><th className="num">Decisions</th><th className="num">Avg return</th></tr></thead>
              <tbody>{s.byConviction.map((c) => <tr key={c.conviction}><td>{c.conviction}/5</td><td className="num">{c.n}</td><td className={`num ${tone(c.avgReturn)}`}>{pct(c.avgReturn, 1, true)}</td></tr>)}</tbody>
            </table>
          )}
          <h3 style={{ marginTop: 12 }}>Post-mortem outcomes</h3>
          <ul className="list small">{outcomes.map((o) => <li key={o.k}><span style={{ flex: 1 }}>{OUTCOMES[o.k as keyof typeof OUTCOMES]}</span><b>{o.n}</b></li>)}</ul>
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <h2>All decisions</h2>
          <div className="seg small">
            {(["all", "open", "unreviewed", "reviewed"] as const).map((x) => (
              <button key={x} className={filter === x ? "active" : ""} onClick={() => setFilter(x)}>{{ all: "All", open: "Buys & adds", unreviewed: "Need a post-mortem", reviewed: "Reviewed" }[x]}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Stock</th><th>Action</th><th className="num">Price</th><th className="num">Now</th><th className="num">Result</th>
                <th className="num">Target</th><th className="num">Progress</th><th className="num">Nasdaq</th><th className="num">Conv.</th><th>Post-mortem</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.d.id}>
                  <td className="small">{r.d.decision_date}</td>
                  <td><Link to={`/s/${encodeURIComponent(r.d.symbol)}`}><b>{r.d.symbol}</b></Link></td>
                  <td>{r.d.action}</td>
                  <td className="num">{money(r.d.price)}</td>
                  <td className="num">{money(r.priceNow)}</td>
                  <td className={`num ${tone(r.decisionReturn)}`}>{pct(r.decisionReturn, 1, true)}</td>
                  <td className="num">{r.d.target_price ? money(r.d.target_price) : "–"}{r.targetHit && <span className="chip accent">hit</span>}{r.stopHit && <span className="chip warn">stop</span>}</td>
                  <td className="num">{pct(r.progressToTarget, 0)}</td>
                  <td className={`num ${tone(r.benchmarkMove)}`}>{pct(r.benchmarkMove, 1, true)}</td>
                  <td className="num">{r.d.conviction ?? "–"}</td>
                  <td className="small">{r.d.outcome ? <span className="chip">{r.d.outcome}</span> : r.days >= MATURE_DAYS ? <Link to={`/s/${encodeURIComponent(r.d.symbol)}`}>write one →</Link> : <span className="muted">too early</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Result: for buys and adds, the stock's move since; for trims, sells and passes, the move you avoided (positive if it then fell). Progress: share of the move to
          your target achieved so far. Nasdaq: the index over the same period, when benchmark data is available.
        </p>
      </div>
    </div>
  );
}
