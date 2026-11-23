import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useApp } from "../data/AppContext";
import { ValuationPanel } from "../components/ValuationPanel";
import { ActivityPanel, NotesPanel, SimplePanel, TargetPanel } from "../components/StockPanels";
import { DecisionsPanel, TripwiresPanel } from "../components/PmPanels";
import { checkTripwire, tripwiresOf } from "../lib/tripwires";
import { Pct, Sparkline } from "../components/common";
import { ago, compact, money, num, pct, tone } from "../lib/format";

type Tab = "valuation" | "target" | "activity" | "notes" | "decisions" | "tripwires";

export default function StockPage() {
  const symbol = decodeURIComponent(useParams().symbol ?? "").toUpperCase();
  const { data, holdings, valuation, mutate, store } = useApp();
  const [tabState, setTab] = useState<Tab>("valuation");
  const md = data!.market[symbol];
  const v = valuation(symbol);
  const h = holdings.find((x) => x.symbol === symbol);
  const watched = data!.watchlist.includes(symbol);
  const settings = data!.valuations[symbol];
  const day = md?.price && md.prevClose ? md.price / md.prevClose - 1 : null;
  const isModel = v?.kind === "model";
  // the 5y target tab only exists for modelled stocks; fall back when switching to e.g. a crypto page
  const tab: Tab = tabState === "target" && !isModel ? "valuation" : tabState;
  const inst = data!.instruments[symbol];
  const wires = tripwiresOf(inst);
  const dcf = v?.kind === "model" && Number.isFinite(v.weightedValue) ? v.weightedValue : null;
  const crossed = wires.filter((w) => checkTripwire(symbol, w, md, dcf).breached).length;
  // Keep the DCF value the twice-daily tripwire check uses in step with what you see here.
  const savedDcf = inst?.extra?.dcfValue as number | undefined;
  useEffect(() => {
    if (!inst || !dcf || !wires.some((w) => w.metric === "priceToDcf")) return;
    if (savedDcf && Math.abs(dcf / savedDcf - 1) < 0.01) return;
    mutate((s) => s.saveInstrument({ ...inst, extra: { ...(inst.extra ?? {}), dcfValue: dcf, dcfAt: new Date().toISOString().slice(0, 10) } }));
  }, [symbol, dcf, savedDcf]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack">
      <div className="card">
        <div className="row between">
          <div>
            <h1>{symbol} <span className="muted" style={{ fontWeight: 400, fontSize: 16 }}>{md?.name}</span></h1>
            <div className="row small muted">
              {md?.exchange && <span className="chip">{md.exchange}</span>}
              {md?.assetClass && <span className="chip">{md.assetClass}</span>}
              {md?.industry && <span>{md.industry}</span>}
              {md && <span>· data {ago(md.updatedAt)}</span>}
            </div>
          </div>
          <div className="row">
            <Sparkline points={md?.history} width={160} height={40} />
            <div style={{ textAlign: "right" }}>
              <div className="num" style={{ fontSize: 24, fontWeight: 650 }}>{money(md?.price)} <span className="small muted">{md?.currency}</span></div>
              <Pct x={day} />
            </div>
            <button onClick={() => mutate((s) => s.setWatch(symbol, !watched))}>{watched ? "★ Watching" : "☆ Watch"}</button>
          </div>
        </div>
        {!md && (
          <p className="banner small" style={{ marginTop: 12 }}>
            No market data for {symbol} yet.{" "}
            {store.mode === "local" ? "Preview mode only has the bundled tickers." : "Add it to the watchlist and it will be fetched on the next refresh."} You can still
            write notes and set a manual price or target.
          </p>
        )}
        <div className="grid kpis" style={{ marginTop: 12 }}>
          <div><div className="small muted">Your position</div><div className="num" style={{ textAlign: "left" }}>{h && h.qty > 0 ? `${num(h.qty, 4)} @ ${money(h.avgCost)}` : "none"}</div></div>
          <div><div className="small muted">Value · P&amp;L (SGD)</div><div className="num" style={{ textAlign: "left" }}>{h && h.qty > 0 ? <>{money(h.valueSgd, undefined, 0)} · <span className={tone(h.unrealizedSgd)}>{pct(h.unrealizedPct, 1, true)}</span></> : "–"}</div></div>
          <div><div className="small muted">Market cap · P/E · P/B</div><div className="num" style={{ textAlign: "left" }}>{compact(md?.marketCap)} · {num(md?.multiples?.pe, 1)} · {num(md?.multiples?.pb, 2)}</div></div>
          <div><div className="small muted">Analysts</div><div className="num" style={{ textAlign: "left" }}>{md?.analyst?.targetMean ? `${money(md.analyst.targetMean)} (${md.analyst.recommendation ?? ""})` : "–"}</div></div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(["valuation", "target", "activity", "notes", "decisions", "tripwires"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)} role="tab" aria-selected={tab === t}>
            {{ valuation: isModel ? "DCF valuation" : "Target", target: "5y target & CAGR", activity: "Events & activity", notes: "Notes", decisions: "Decisions", tripwires: "Tripwires" }[t]}
            {t === "tripwires" && crossed > 0 && <span className="chip warn" style={{ marginLeft: 6 }}>{crossed}</span>}
          </button>
        )).filter((_, i) => isModel || i !== 1)}
      </div>

      {tab === "valuation" && (isModel ? <ValuationPanel symbol={symbol} v={v} settings={settings} /> : <SimplePanel symbol={symbol} v={v && v.kind === "target" ? v : null} md={md} />)}
      {tab === "target" && isModel && <TargetPanel symbol={symbol} v={v} settings={settings} />}
      {tab === "activity" && <ActivityPanel symbol={symbol} md={md} />}
      {tab === "notes" && <NotesPanel symbol={symbol} />}
      {tab === "decisions" && <DecisionsPanel symbol={symbol} md={md} v={v} />}
      {tab === "tripwires" && <TripwiresPanel symbol={symbol} md={md} v={v} />}
      {md?.gaps && md.gaps.length > 0 && <details className="small"><summary>Data gaps for this symbol</summary><ul>{md.gaps.map((g) => <li key={g}>{g}</li>)}</ul></details>}
    </div>
  );
}
