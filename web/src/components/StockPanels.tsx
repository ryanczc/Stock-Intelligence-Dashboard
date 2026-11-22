import { useState } from "react";
import { useApp } from "../data/AppContext";
import { uid } from "../data/store";
import type { MarketData, ValuationSettings } from "../lib/types";
import { DEFAULT_PROBABILITIES, EXIT_METRICS, allowedExitMetrics, claudeCase, compMultiple, type ClaudeCase, type ExitMetric, type SimpleTarget, type Valuation } from "../lib/valuation";
import { compact, daysUntil, money, num, pct, tone } from "../lib/format";

// ---------------------------------------------------------------------------------------------
export function TargetPanel({ symbol, v, settings }: { symbol: string; v: Valuation; settings: ValuationSettings | undefined }) {
  const { mutate, data } = useApp();
  const s: ValuationSettings = settings ?? { overrides: {}, probabilities: DEFAULT_PROBABILITIES };
  const save = (next: ValuationSettings) => mutate((st) => st.saveValuation(symbol, next));
  const [comp, setComp] = useState("");
  const e = v.exit;
  const rep = v.defaults.context.reportingCurrency;
  const trd = v.defaults.context.tradingCurrency;
  const comps = s.comps ?? [];

  return (
    <div className="stack">
      <div className="grid kpis">
        {e.metric === "pe" && e.netIncomeYear5 != null && (
          <div className="card kpi"><div className="label">Year-5 net income</div><div className="value">{compact(e.netIncomeYear5)}</div><div className="sub muted">{rep}, base case</div></div>
        )}
        <div className="card kpi"><div className="label">Year-5 {EXIT_METRICS[e.metric].metricLabel}</div><div className="value">{num(e.metricValueYear5)}</div><div className="sub muted">{rep}, base case</div></div>
        <div className="card kpi"><div className="label">Exit multiple</div><div className="value">{num(e.multiple, 1)}x</div><div className="sub muted">{e.multipleSource}</div></div>
        <div className="card kpi"><div className="label">5-year price target</div><div className="value">{money(e.priceTarget)}</div><div className="sub muted">{trd} · plus {money(e.dividends5y)} dividends</div></div>
        <div className="card kpi"><div className="label">CAGR (total return)</div><div className={`value ${tone(e.cagr)}`}>{pct(e.cagr, 1, true)}</div><div className="sub muted">from {money(v.price)}</div></div>
      </div>

      <div className="card">
        <h2>Exit multiple</h2>
        <p className="small">
          5-year target = year-5 {EXIT_METRICS[e.metric].metricLabel} {num(e.metricValueYear5)} {rep} × {num(e.multiple, 1)}x
          {e.metric === "evEbitda" ? " − net debt per share" : ""}
          {rep !== trd ? `, converted to ${trd}` : ""} = <b>{money(e.priceTarget, trd)}</b>. The year-5 figure comes from the base case growth and margins on the Valuation tab, so changing those changes the target.
        </p>
        {v.claude?.exitMultiple != null && v.claude.rationale?.exitMultiple && (
          <p className="small muted">Claude base case multiple ({v.claude.exitMultiple}x {EXIT_METRICS[(v.claude.exitMetric ?? "pe") as ExitMetric]?.label}): {v.claude.rationale.exitMultiple}</p>
        )}
        <div className="form-grid">
          <label className="field">
            Metric
            <select value={e.metric} onChange={(ev) => save({ ...s, exitMetric: ev.target.value, exitMultiple: null })}>
              {allowedExitMetrics(v.model).map((m) => <option key={m} value={m}>{EXIT_METRICS[m].label}</option>)}
            </select>
          </label>
          <label className="field">
            Your multiple (blank = {v.claude?.exitMultiple ? "Claude base case" : "median of candidates"})
            <input
              key={e.metric}
              type="number"
              step="0.5"
              defaultValue={s.exitMultiple ?? ""}
              placeholder={num(e.multiple, 1)}
              onBlur={(ev) => save({ ...s, exitMultiple: ev.target.value ? Number(ev.target.value) : null })}
            />
          </label>
        </div>
        <table style={{ marginTop: 12, maxWidth: 640 }}>
          <thead><tr><th>Candidate</th><th className="num">Multiple</th></tr></thead>
          <tbody>
            {e.candidates.map((c) => <tr key={c.source}><td>{c.source}</td><td className="num">{num(c.multiple, 1)}x</td></tr>)}
            {!e.candidates.length && <tr><td colSpan={2} className="muted">No candidates. Add comps or set your own multiple.</td></tr>}
          </tbody>
        </table>
        <p className="small muted">
          The growth-justified multiple is the base-case DCF value at the end of year 5 divided by the year-5 metric, so it reflects the slower growth expected
          after year 5. Industry multiples come from Damodaran's dataset; comps use each company's current trailing multiple.
          {v.model === "reitDdm" && " REIT FFO is approximated from distributions; override it if you have the reported figure."}
        </p>
      </div>

      <div className="card">
        <div className="row between">
          <h2>Comparable companies</h2>
          <form className="row" onSubmit={(ev) => { ev.preventDefault(); const c = comp.trim().toUpperCase(); if (c && !comps.includes(c)) save({ ...s, comps: [...comps, c] }); setComp(""); }}>
            <input placeholder="Add comp, e.g. O39.SI" value={comp} onChange={(ev) => setComp(ev.target.value)} />
            <button>Add</button>
          </form>
        </div>
        {!comps.length ? (
          <p className="muted small">No comps yet. Comps added here are fetched by the next data refresh.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Comp</th>{(Object.keys(EXIT_METRICS) as ExitMetric[]).map((m) => <th key={m} className="num">{EXIT_METRICS[m].label}</th>)}<th /></tr></thead>
              <tbody>
                {comps.map((c) => {
                  const m = data?.market[c];
                  return (
                    <tr key={c}>
                      <td><b>{c}</b> <span className="muted small">{m?.name ?? "waiting for data"}</span></td>
                      {(Object.keys(EXIT_METRICS) as ExitMetric[]).map((k) => <td key={k} className="num">{m ? num(compMultiple(m, k, data!.fx), 1) : "–"}</td>)}
                      <td><button className="ghost danger" onClick={() => save({ ...s, comps: comps.filter((x) => x !== c) })}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
/** Crypto, ETFs, cash, bonds: no intrinsic model. User target + market metrics. */
export function SimplePanel({ symbol, v, md }: { symbol: string; v: SimpleTarget | null; md?: MarketData }) {
  const { data, mutate } = useApp();
  const inst = data!.instruments[symbol] ?? { symbol };
  const save = (patch: Partial<typeof inst>) => mutate((st) => st.saveInstrument({ ...inst, ...patch, extra: { ...(inst.extra ?? {}), ...(patch.extra ?? {}) } }));
  const c = md?.crypto;
  return (
    <div className="stack">
      <div className="grid kpis">
        <div className="card kpi"><div className="label">Your 5-year target</div><div className="value">{money(v?.targetPrice5y)}</div><div className="sub muted">{md?.currency ?? inst.currency}</div></div>
        <div className="card kpi"><div className="label">CAGR to target</div><div className={`value ${tone(v?.cagr)}`}>{pct(v?.cagr, 1, true)}</div><div className="sub muted">from {money(v?.price)}</div></div>
        {c ? (
          <>
            <div className="card kpi"><div className="label">High (all-time or 2-year)</div><div className="value">{money(c.allTimeHigh)}</div><div className="sub muted">{pct(md?.price && c.allTimeHigh ? md.price / c.allTimeHigh - 1 : null, 1, true)} from high</div></div>
            <div className="card kpi"><div className="label">Market cap · 24h volume</div><div className="value">{compact(md?.marketCap)}</div><div className="sub muted">{compact(c.volume24h)} volume · {compact(c.circulatingSupply)} supply</div></div>
          </>
        ) : (
          <div className="card kpi"><div className="label">52-week range</div><div className="value small">{money(md?.fiftyTwoWeekLow)} – {money(md?.fiftyTwoWeekHigh)}</div><div className="sub muted">yield {pct(md?.dividendYield ? md.dividendYield / 100 : null)}</div></div>
        )}
      </div>
      <div className="card">
        <h2>Your inputs</h2>
        {v?.claude && (
          <div className="banner small" style={{ marginBottom: 8 }}>
            <b>Claude base case ({v.claude.asOf}):</b> {v.claude.summary}{" "}
            <button className="ghost" onClick={() => mutate((st) => st.saveValuation(symbol, { ...(data!.valuations[symbol] ?? { overrides: {}, probabilities: DEFAULT_PROBABILITIES }), model: "fcff" }))}>Run a DCF anyway</button>
          </div>
        )}
        <p className="small muted">
          {md?.assetClass === "crypto"
            ? "Crypto has no cash flows to discount, so there is no DCF. Set your own 5-year target."
            : v?.claude?.noDcf
            ? "Set your own 5-year target from the holdings-based value above, or run a DCF anyway."
            : "No DCF for ETFs, cash or bonds. Set a 5-year target, and a manual price if the data feed has none (bonds, fixed deposits)."}
        </p>
        <div className="form-grid">
          <label className="field">5-year target price<input type="number" step="any" defaultValue={inst.extra?.targetPrice5y ?? ""} onBlur={(e) => save({ extra: { targetPrice5y: e.target.value ? Number(e.target.value) : null } })} /></label>
          <label className="field">Manual price (if no feed)<input type="number" step="any" defaultValue={inst.manual_price ?? ""} onBlur={(e) => save({ manual_price: e.target.value ? Number(e.target.value) : null, manual_price_date: new Date().toISOString().slice(0, 10) })} /></label>
          <label className="field">
            Asset class
            <select defaultValue={inst.asset_class ?? md?.assetClass ?? ""} onChange={(e) => save({ asset_class: (e.target.value || null) as never })}>
              <option value="">Automatic</option>
              {["stock", "bank", "insurer", "reit", "etf", "crypto", "bond", "cash"].map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function ActivityPanel({ symbol, md }: { symbol: string; md?: MarketData }) {
  const { data, mutate } = useApp();
  const [ev, setEv] = useState({ date: "", title: "", type: "custom" });
  const custom = data!.customEvents.filter((e) => e.symbol === symbol);
  const events = [...(md?.events ?? []).map((e) => ({ ...e, id: "" })), ...custom].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="stack">
      <div className="grid halves">
        <div className="card">
          <h2>Key events</h2>
          <ul className="list">
            {events.map((e, i) => (
              <li key={i}>
                <span className="when">{e.date}</span>
                <span style={{ flex: 1 }}>{e.title} {daysUntil(e.date) >= 0 && <span className="chip accent">in {daysUntil(e.date)}d</span>}</span>
                <span className="chip">{e.type}</span>
                {e.id && <button className="ghost danger" onClick={() => mutate((s) => s.deleteCustomEvent(e.id))}>✕</button>}
              </li>
            ))}
            {!events.length && <li className="muted">No events from the data feed.</li>}
          </ul>
          <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); if (ev.date && ev.title) mutate((s) => s.saveCustomEvent({ id: uid(), symbol, ...ev })); setEv({ date: "", title: "", type: "custom" }); }}>
            <input type="date" value={ev.date} onChange={(e) => setEv({ ...ev, date: e.target.value })} aria-label="Event date" />
            <input placeholder="Add an event (AGM, token unlock…)" value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} style={{ flex: 1 }} />
            <select value={ev.type} onChange={(e) => setEv({ ...ev, type: e.target.value })} aria-label="Event type">
              {["custom", "agm", "unlock", "earnings", "dividend"].map((t) => <option key={t}>{t}</option>)}
            </select>
            <button>Add</button>
          </form>
        </div>
        <div className="card">
          <h2>Headlines</h2>
          <ul className="list">
            {(md?.news ?? []).map((n, i) => (
              <li key={i}><span className="when">{n.time?.slice(5, 10)}</span><span><a href={n.url} target="_blank" rel="noreferrer">{n.title}</a> <span className="muted small">· {n.publisher}</span></span></li>
            ))}
            {!md?.news?.length && <li className="muted">No headlines.</li>}
          </ul>
        </div>
      </div>
      <div className="card">
        <h2>Insider transactions</h2>
        {!md?.insiders?.length ? <p className="muted small">None reported (Yahoo covers US insiders; SGX/HKEX director dealings are not in the free feed).</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Insider</th><th>Transaction</th><th className="num">Shares</th><th className="num">Value</th></tr></thead>
              <tbody>{md.insiders.map((t, i) => <tr key={i}><td>{t.date}</td><td>{t.insider}<div className="small muted">{t.position}</div></td><td className="small">{t.text}</td><td className="num">{compact(t.shares)}</td><td className="num">{compact(t.value)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card">
        <h2>Top institutional holders (13F)</h2>
        {!md?.institutions?.length ? <p className="muted small">No data.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Holder</th><th>Reported</th><th className="num">% held</th><th className="num">Value</th><th className="num">Change</th></tr></thead>
              <tbody>{md.institutions.map((h, i) => <tr key={i}><td>{h.holder}</td><td>{h.date}</td><td className="num">{pct(h.pctHeld, 2)}</td><td className="num">{compact(h.value)}</td><td className={`num ${tone(h.pctChange)}`}>{pct(h.pctChange, 1, true)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export function NotesPanel({ symbol }: { symbol: string }) {
  const { data, mutate } = useApp();
  const [thesis, setThesis] = useState(data!.notes[symbol] ?? "");
  const [entry, setEntry] = useState({ body: "", tags: "", date: new Date().toISOString().slice(0, 10) });
  const [filter, setFilter] = useState("");
  const journal = data!.journal.filter((j) => j.symbol === symbol).sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  const tags = [...new Set(journal.flatMap((j) => j.tags))];
  const dirty = thesis !== (data!.notes[symbol] ?? "");
  const cc = claudeCase(symbol);
  return (
    <div className="stack">
    {cc ? (
      <ClaudeThesisCard c={cc} onCopy={(text) => setThesis(thesis ? `${thesis}\n\n${text}` : text)} />
    ) : (
      <div className="card small muted">No Claude thesis for {symbol} yet. The weekly Claude research (Sundays) adds every stock you hold or watch.</div>
    )}
    <div className="grid halves">
      <div className="card">
        <div className="row between">
          <h2>📌 Thesis</h2>
          <button className="primary" disabled={!dirty} onClick={() => mutate((s) => s.saveThesis(symbol, thesis))}>{dirty ? "Save" : "Saved"}</button>
        </div>
        <textarea value={thesis} onChange={(e) => setThesis(e.target.value)} placeholder="Why you own or watch this. What would make you sell. Key risks and what to monitor." style={{ minHeight: 260 }} />
      </div>
      <div className="card">
        <h2>Journal</h2>
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          if (!entry.body.trim()) return;
          mutate((s) => s.saveJournal({ id: uid(), symbol, entry_date: entry.date, body: entry.body.trim(), tags: entry.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) }));
          setEntry({ ...entry, body: "", tags: "" });
        }}>
          <textarea value={entry.body} onChange={(e) => setEntry({ ...entry, body: e.target.value })} placeholder="What happened, what you think, what you'll do." style={{ minHeight: 90 }} />
          <div className="row">
            <input type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} aria-label="Entry date" />
            <input placeholder="tags, comma separated (earnings, risk…)" value={entry.tags} onChange={(e) => setEntry({ ...entry, tags: e.target.value })} style={{ flex: 1 }} />
            <button className="primary">Add entry</button>
          </div>
        </form>
        {tags.length > 0 && (
          <div className="row" style={{ marginTop: 12 }}>
            <button className={`chip ${!filter ? "accent" : ""}`} onClick={() => setFilter("")}>all</button>
            {tags.map((t) => <button key={t} className={`chip ${filter === t ? "accent" : ""}`} onClick={() => setFilter(t)}>#{t}</button>)}
          </div>
        )}
        <ul className="list" style={{ marginTop: 8 }}>
          {journal.filter((j) => !filter || j.tags.includes(filter)).map((j) => (
            <li key={j.id} style={{ display: "block" }}>
              <div className="row between">
                <span className="when">{j.entry_date}</span>
                <span className="row">{j.tags.map((t) => <span key={t} className="chip">#{t}</span>)}<button className="ghost danger" onClick={() => mutate((s) => s.deleteJournal(j.id))} aria-label="Delete entry">✕</button></span>
              </div>
              <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{j.body}</div>
            </li>
          ))}
          {!journal.length && <li className="muted">No entries yet.</li>}
        </ul>
      </div>
    </div>
    </div>
  );
}

function bulletText(c: ClaudeCase) {
  const t = c.thesis!;
  const list = (title: string, xs: string[]) => (xs.length ? `\n${title}:\n${xs.map((x) => `- ${x}`).join("\n")}` : "");
  return `${t.text}${list("Bull points", t.bull)}${list("Risks", t.bear)}${list("Watch", t.watch)}\n(From Claude's thesis, ${c.asOf})`;
}

export function ClaudeThesisCard({ c, onCopy }: { c: ClaudeCase; onCopy?: (text: string) => void }) {
  const [showLog, setShowLog] = useState(false);
  const t = c.thesis;
  if (!t) return null;
  const changes = [...(c.changes ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="card claude-card">
      <div className="row between">
        <h2>Claude's thesis <span className="muted small">· updated {c.asOf}</span></h2>
        {onCopy && <button className="ghost" onClick={() => onCopy(bulletText(c))} title="Adds this text to your thesis box below; nothing is saved until you click Save">Copy into my thesis</button>}
      </div>
      <p style={{ marginTop: 6 }}>{t.text}</p>
      <div className="grid three-col small">
        <div><b className="pos">Bull points</b><ul>{t.bull.map((x) => <li key={x}>{x}</li>)}</ul></div>
        <div><b className="neg">Risks</b><ul>{t.bear.map((x) => <li key={x}>{x}</li>)}</ul></div>
        <div><b>What to watch</b><ul>{t.watch.map((x) => <li key={x}>{x}</li>)}</ul></div>
      </div>
      {changes[0] && (
        <div className="small" style={{ marginTop: 8 }}>
          <b>Latest change ({changes[0].date}):</b> {changes[0].text}{" "}
          {changes.length > 1 && <button className="ghost" onClick={() => setShowLog(!showLog)}>{showLog ? "Hide" : "Show"} history ({changes.length})</button>}
        </div>
      )}
      {showLog && (
        <ul className="list small">
          {changes.slice(1).map((x, i) => <li key={i}><span className="when">{x.date}</span><span>{x.text}</span></li>)}
        </ul>
      )}
      {!!c.sources?.length && (
        <div className="small muted" style={{ marginTop: 8 }}>
          Sources: {c.sources.map((x, i) => <span key={x.url}>{i > 0 && " · "}<a href={x.url} target="_blank" rel="noreferrer">{x.title}</a></span>)}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>Claude's view is kept separate from yours. It refreshes weekly through a pull request you approve; your own thesis and journal are never changed.</p>
    </div>
  );
}
