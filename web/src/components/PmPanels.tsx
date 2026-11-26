// Portfolio-manager tools on the stock page: decision journal (with post-mortems) and thesis tripwires.
import { useState } from "react";
import { useApp } from "../data/AppContext";
import { uid } from "../data/store";
import type { Decision, MarketData, TripMetric, Tripwire } from "../lib/types";
import type { SimpleTarget, Valuation } from "../lib/valuation";
import { evaluateDecision } from "../lib/review";
import { TRIP_METRICS, checkTripwire, describe, formatMetric, tripwiresOf } from "../lib/tripwires";
import { money, pct, tone } from "../lib/format";

const ACTIONS: Decision["action"][] = ["buy", "add", "trim", "sell", "pass"];
export const OUTCOMES: Record<NonNullable<Decision["outcome"]>, string> = {
  "good-good": "Good decision, good outcome (skill)",
  "good-bad": "Good decision, bad outcome (bad luck)",
  "bad-good": "Bad decision, good outcome (got lucky)",
  "bad-bad": "Bad decision, bad outcome (mistake)",
};

export function MissingTableBanner() {
  const { data } = useApp();
  if (!data?.missingTables.includes("decisions")) return null;
  return (
    <div className="banner small">
      <b>One-time setup needed for the decision journal.</b> In Supabase, open <b>SQL Editor → + New query</b>, paste the contents of{" "}
      <a href="https://github.com/ryanczc/Stock-Intelligence-Dashboard/blob/main/supabase/add-decisions.sql" target="_blank" rel="noreferrer">supabase/add-decisions.sql</a>, click <b>Run</b>,
      then reload this page.
    </div>
  );
}

export function DecisionsPanel({ symbol, md, v }: { symbol: string; md?: MarketData; v: Valuation | SimpleTarget | null }) {
  const { data, mutate, holdings } = useApp();
  const d = data!;
  const today = new Date().toISOString().slice(0, 10);
  const lastTrade = [...d.transactions].filter((t) => t.symbol === symbol && (t.type === "buy" || t.type === "sell")).sort((a, b) => b.trade_date.localeCompare(a.trade_date))[0];
  const dcfNow = v?.kind === "model" && Number.isFinite(v.weightedValue) ? v.weightedValue : null;
  const target5y = v?.kind === "model" ? v.exit.priceTarget : v?.kind === "target" ? v.targetPrice5y : null;
  const blank = () => ({
    action: "buy" as Decision["action"],
    decision_date: today,
    price: md?.price ? String(+md.price.toFixed(4)) : "",
    thesis: "",
    target_price: target5y && Number.isFinite(target5y) ? String(+target5y.toFixed(2)) : "",
    stop_price: "",
    conviction: "3",
    horizon_months: "60",
  });
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [review, setReview] = useState<{ text: string; outcome: string }>({ text: "", outcome: "" });
  const list = d.decisions.filter((x) => x.symbol === symbol).sort((a, b) => b.decision_date.localeCompare(a.decision_date));
  const held = holdings.find((h) => h.symbol === symbol);
  const n = (s: string) => (s.trim() === "" ? null : Number(s));

  if (d.missingTables.includes("decisions")) return <MissingTableBanner />;

  return (
    <div className="stack">
      <div className="card">
        <div className="row between">
          <h2>Log a decision</h2>
          {lastTrade && (
            <button
              className="ghost"
              onClick={() => setF({ ...f, action: lastTrade.type === "sell" ? (held && held.qty > 0 ? "trim" : "sell") : held && held.qty > lastTrade.quantity ? "add" : "buy", decision_date: lastTrade.trade_date, price: String(lastTrade.price) })}
            >
              Fill from my last trade ({lastTrade.type} {lastTrade.trade_date})
            </button>
          )}
        </div>
        <p className="small muted">Write down why, what it's worth and what would prove you wrong, before you know the outcome. The Review page scores these later.</p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!n(f.price) || !f.thesis.trim()) return;
            const dec: Decision = {
              id: uid(),
              symbol,
              decision_date: f.decision_date,
              action: f.action,
              price: n(f.price)!,
              thesis: f.thesis.trim(),
              target_price: n(f.target_price),
              stop_price: n(f.stop_price),
              conviction: n(f.conviction),
              horizon_months: n(f.horizon_months),
              dcf_value: dcfNow,
            };
            mutate((s) => s.saveDecision(dec));
            setF(blank());
          }}
        >
          <div className="form-grid">
            <label className="field">Action
              <select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value as Decision["action"] })}>
                {ACTIONS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
            <label className="field">Date<input type="date" value={f.decision_date} onChange={(e) => setF({ ...f, decision_date: e.target.value })} /></label>
            <label className="field">Price ({md?.currency ?? "trading ccy"})<input type="number" step="any" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required /></label>
            <label className="field">Target price<input type="number" step="any" value={f.target_price} onChange={(e) => setF({ ...f, target_price: e.target.value })} placeholder="e.g. your 5y target" /></label>
            <label className="field">Stop / "I'm wrong" price<input type="number" step="any" value={f.stop_price} onChange={(e) => setF({ ...f, stop_price: e.target.value })} placeholder="optional" /></label>
            <label className="field">Conviction (1-5)
              <select value={f.conviction} onChange={(e) => setF({ ...f, conviction: e.target.value })}>
                {["1", "2", "3", "4", "5"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="field">Horizon (months)<input type="number" value={f.horizon_months} onChange={(e) => setF({ ...f, horizon_months: e.target.value })} /></label>
          </div>
          <textarea value={f.thesis} onChange={(e) => setF({ ...f, thesis: e.target.value })} placeholder="Why now? What's the variant view? What would make you sell?" style={{ minHeight: 90 }} required />
          <div className="row between">
            <span className="small muted">{dcfNow ? `Your DCF value today (${money(dcfNow)}) is saved with it, to check later whether your DCFs run high or low.` : ""}</span>
            <button className="primary">Save decision</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Decisions on {symbol}</h2>
        {!list.length ? <div className="empty">No decisions logged yet.</div> : (
          <ul className="list">
            {list.map((x) => {
              const r = evaluateDecision(x, md, d.benchmarks.NDX);
              return (
                <li key={x.id} style={{ display: "block" }}>
                  <div className="row between">
                    <span>
                      <span className="when">{x.decision_date}</span> <b>{x.action.toUpperCase()}</b> @ {money(x.price)}
                      {x.target_price ? <span className="small muted"> · target {money(x.target_price)}</span> : null}
                      {x.stop_price ? <span className="small muted"> · stop {money(x.stop_price)}</span> : null}
                      {x.conviction ? <span className="small muted"> · conviction {x.conviction}/5</span> : null}
                    </span>
                    <span className="row small">
                      <span className={tone(r.decisionReturn)} title="Return credited to this decision (for sells/trims: the move you avoided)">{pct(r.decisionReturn, 1, true)}</span>
                      {r.targetHit && <span className="chip accent">target hit</span>}
                      {r.stopHit && <span className="chip warn">stop hit</span>}
                      {x.outcome && <span className="chip">{x.outcome}</span>}
                      <button className="ghost" onClick={() => { setEditing(editing === x.id ? null : x.id); setReview({ text: x.review ?? "", outcome: x.outcome ?? "" }); }}>Post-mortem</button>
                      <button className="ghost danger" onClick={() => mutate((s) => s.deleteDecision(x.id))} aria-label="Delete decision">✕</button>
                    </span>
                  </div>
                  <div className="small" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{x.thesis}</div>
                  {x.review && editing !== x.id && <div className="small muted" style={{ marginTop: 4 }}><b>Post-mortem {x.reviewed_at}:</b> {x.review}</div>}
                  {editing === x.id && (
                    <div className="stack" style={{ marginTop: 8 }}>
                      <select value={review.outcome} onChange={(e) => setReview({ ...review, outcome: e.target.value })} aria-label="Outcome">
                        <option value="">How did it go?</option>
                        {Object.entries(OUTCOMES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </select>
                      <textarea value={review.text} onChange={(e) => setReview({ ...review, text: e.target.value })} placeholder="What happened vs the thesis? What would you do differently?" />
                      <div className="row">
                        <button className="primary" onClick={() => { mutate((s) => s.saveDecision({ ...x, review: review.text.trim() || null, outcome: (review.outcome || null) as Decision["outcome"], reviewed_at: today })); setEditing(null); }}>Save post-mortem</button>
                        <button className="ghost" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function TripwiresPanel({ symbol, md, v }: { symbol: string; md?: MarketData; v: Valuation | SimpleTarget | null }) {
  const { data, mutate } = useApp();
  const inst = data!.instruments[symbol] ?? { symbol };
  const wires = tripwiresOf(inst);
  const dcf = v?.kind === "model" && Number.isFinite(v.weightedValue) ? v.weightedValue : null;
  const [f, setF] = useState<{ metric: TripMetric; op: "<" | ">"; value: string; note: string }>({ metric: "revenueGrowth", op: "<", value: "", note: "" });
  const kind = TRIP_METRICS[f.metric].kind;
  const save = (next: Tripwire[]) =>
    mutate((s) => s.saveInstrument({ ...inst, extra: { ...(inst.extra ?? {}), tripwires: next, dcfValue: dcf, dcfAt: new Date().toISOString().slice(0, 10) } }));

  return (
    <div className="stack">
      <div className="card">
        <h2>Thesis tripwires</h2>
        <p className="small muted">
          Set the lines that would break your thesis or make you act, e.g. "revenue growth below 15%" or "price above 120% of DCF value". They're checked after every
          data refresh (5:30 PM and 6 AM Singapore time), shown on the Dashboard when crossed, and sent to Telegram if you've set it up.
        </p>
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          const raw = Number(f.value);
          if (f.value.trim() === "" || !Number.isFinite(raw)) return;
          const value = kind === "pct" ? raw / 100 : raw;
          save([...wires, { id: uid(), metric: f.metric, op: f.op, value, note: f.note.trim() || undefined }]);
          setF({ ...f, value: "", note: "" });
        }}>
          <select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value as TripMetric })} aria-label="Metric">
            {(Object.keys(TRIP_METRICS) as TripMetric[]).map((m) => <option key={m} value={m}>{TRIP_METRICS[m].label}</option>)}
          </select>
          <select value={f.op} onChange={(e) => setF({ ...f, op: e.target.value as "<" | ">" })} aria-label="Direction">
            <option value="<">falls below</option>
            <option value=">">rises above</option>
          </select>
          <input type="number" step="any" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder={kind === "pct" ? "e.g. 15 (%)" : kind === "x" ? "e.g. 40 (x)" : "e.g. 100"} style={{ width: 130 }} aria-label="Threshold" />
          {kind === "pct" && <span className="muted small">%</span>}
          <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Why it matters (optional)" style={{ flex: 1, minWidth: 160 }} />
          <button className="primary">Add tripwire</button>
        </form>
        <p className="small muted">Now: {TRIP_METRICS[f.metric].label} is <b>{formatMetric(f.metric, checkTripwire(symbol, { id: "", metric: f.metric, op: f.op, value: 0 }, md, dcf).value)}</b>. {TRIP_METRICS[f.metric].help}</p>
      </div>

      <div className="card">
        <h2>Your tripwires for {symbol}</h2>
        {!wires.length ? <div className="empty">None yet.</div> : (
          <table>
            <thead><tr><th>Rule</th><th className="num">Now</th><th>Status</th><th>Why</th><th /></tr></thead>
            <tbody>
              {wires.map((w) => {
                const st = checkTripwire(symbol, w, md, dcf);
                return (
                  <tr key={w.id}>
                    <td>{describe(w)}</td>
                    <td className="num">{formatMetric(w.metric, st.value)}</td>
                    <td>{st.value == null ? <span className="chip">no data</span> : st.breached ? <span className="chip warn">CROSSED</span> : <span className="chip accent">ok</span>}</td>
                    <td className="small muted">{w.note ?? ""}</td>
                    <td><button className="ghost danger" onClick={() => save(wires.filter((x) => x.id !== w.id))} aria-label="Delete tripwire">✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {wires.some((w) => w.metric === "priceToDcf") && (
          <p className="small muted">The twice-daily check uses the DCF value saved when you last changed tripwires or opened this page ({String(inst.extra?.dcfValue ? money(inst.extra.dcfValue as number) : "–")}, {String(inst.extra?.dcfAt ?? "–")}).</p>
        )}
      </div>
    </div>
  );
}
