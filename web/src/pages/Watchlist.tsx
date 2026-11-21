import { useState } from "react";
import { useApp } from "../data/AppContext";
import { Pct, Sparkline, SymbolCell, valuationCells } from "../components/common";
import { money, daysUntil } from "../lib/format";

export default function Watchlist() {
  const { data, mutate, valuation, holdings, store } = useApp();
  const [sym, setSym] = useState("");
  const list = data!.watchlist;
  const held = new Map(holdings.filter((h) => h.qty > 0).map((h) => [h.symbol, h]));

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = sym.trim().toUpperCase();
    if (!s) return;
    await mutate((st) => st.setWatch(s, true));
    setSym("");
  };

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2>Watchlist</h2>
        <form className="row" onSubmit={add}>
          <input placeholder="e.g. GOOGL, O39.SI, 9988.HK, SOL-USD" value={sym} onChange={(e) => setSym(e.target.value)} />
          <button className="primary">Add</button>
        </form>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Use Yahoo Finance symbols: SGX ends in .SI, HKEX in .HK (4 digits), crypto in -USD.
        {store.mode === "supabase" ? " New symbols get data on the next scheduled refresh (5:30 PM or 6 AM SGT), or run the workflow by hand from GitHub Actions." : ""}
      </p>
      {!list.length ? (
        <div className="empty">Nothing on the watchlist yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="num">Price</th>
                <th className="num">Day</th>
                <th>1y</th>
                <th className="num">Your avg cost</th>
                <th className="num">DCF value</th>
                <th className="num">Upside</th>
                <th className="num">5y target</th>
                <th className="num">CAGR</th>
                <th>Next event</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const m = data!.market[s];
                const v = valuationCells(valuation(s), m?.currency ?? "");
                const h = held.get(s);
                const next = (m?.events ?? []).filter((e) => daysUntil(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0];
                const day = m?.price && m?.prevClose ? m.price / m.prevClose - 1 : null;
                return (
                  <tr key={s}>
                    <SymbolCell symbol={s} name={m?.name ?? "waiting for data"} />
                    <td className="num">
                      {money(m?.price)} <span className="muted small">{m?.currency}</span>
                    </td>
                    <td className="num"><Pct x={day} /></td>
                    <td><Sparkline points={m?.history} /></td>
                    <td className="num">{h ? money(h.avgCost) : <span className="muted">–</span>}</td>
                    <td className="num">{v.dcf}</td>
                    <td className="num"><Pct x={v.upside} /></td>
                    <td className="num">{v.target}</td>
                    <td className="num"><Pct x={v.cagr} /></td>
                    <td className="small">{next ? `${next.title}, ${next.date}` : <span className="muted">–</span>}</td>
                    <td>
                      <button className="ghost danger" onClick={() => mutate((st) => st.setWatch(s, false))} aria-label={`Remove ${s}`}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
