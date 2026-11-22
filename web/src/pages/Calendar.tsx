import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../data/AppContext";
import { uid } from "../data/store";
import { allEvents, type CalendarItem } from "../lib/activity";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function Calendar() {
  const { data, holdings, mutate } = useApp();
  const d = data!;
  const now = new Date();
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [scope, setScope] = useState<"all" | "holdings">("all");
  const [types, setTypes] = useState<Record<string, boolean>>({});
  const [ev, setEv] = useState({ date: "", title: "", symbol: "", type: "custom" });

  const held = holdings.filter((h) => h.qty > 0).map((h) => h.symbol);
  const symbols = scope === "holdings" ? held : [...new Set([...held, ...d.watchlist])];
  const events = useMemo(() => allEvents(symbols, d.market, d.macro, d.customEvents), [symbols.join(","), d]); // eslint-disable-line react-hooks/exhaustive-deps
  const allTypes = [...new Set(events.map((e) => e.type))].sort();
  const shown = events.filter((e) => types[e.type] !== false && (scope === "all" || !e.symbol || held.includes(e.symbol)));

  // grid: Monday on or before the 1st, through the Sunday on or after month end
  const first = new Date(month);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - ((last.getDay() + 6) % 7)));
  const days: Date[] = [];
  for (let x = new Date(start); x <= end; x.setDate(x.getDate() + 1)) days.push(new Date(x));
  const byDay = new Map<string, CalendarItem[]>();
  for (const e of shown) byDay.set(e.date.slice(0, 10), [...(byDay.get(e.date.slice(0, 10)) ?? []), e]);
  const monthKey = iso(month).slice(0, 7);
  const monthEvents = shown.filter((e) => e.date.startsWith(monthKey));
  const today = iso(now);
  const label = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  const Ev = ({ e }: { e: CalendarItem }) => {
    const cls = `ev ${e.type === "earnings" ? "earnings" : e.source === "macro" ? "macro" : ""}`;
    const text = `${e.symbol ? e.symbol + " " : ""}${e.type === "earnings" ? "earnings" : e.title}`;
    return e.symbol ? <Link className={cls} to={`/s/${encodeURIComponent(e.symbol)}`} title={e.title}>{text}</Link> : <span className={cls} title={e.title}>{text}</span>;
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="row between">
          <div className="row">
            <button onClick={() => shift(-1)} aria-label="Previous month">‹</button>
            <h2 style={{ minWidth: 170, textAlign: "center" }}>{label}</h2>
            <button onClick={() => shift(1)} aria-label="Next month">›</button>
            <button className="ghost" onClick={() => setMonth(new Date(now.getFullYear(), now.getMonth(), 1))}>Today</button>
          </div>
          <div className="row small">
            <div className="seg">
              <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>Holdings + watchlist</button>
              <button className={scope === "holdings" ? "active" : ""} onClick={() => setScope("holdings")}>Holdings only</button>
            </div>
          </div>
        </div>
        <div className="row small" style={{ margin: "10px 0" }}>
          {allTypes.map((t) => (
            <button key={t} className={`chip ${types[t] !== false ? "accent" : ""}`} onClick={() => setTypes({ ...types, [t]: types[t] === false })}>{t}</button>
          ))}
        </div>

        <div className="cal">
          {DOW.map((x) => <div key={x} className="dow">{x}</div>)}
          {days.map((x) => {
            const k = iso(x);
            const list = byDay.get(k) ?? [];
            return (
              <div key={k} className={`day ${x.getMonth() !== month.getMonth() ? "other" : ""} ${k === today ? "today" : ""}`}>
                <span className="num-day">{x.getDate()}</span>
                {list.slice(0, 4).map((e, i) => <Ev key={i} e={e} />)}
                {list.length > 4 && <span className="small muted">+{list.length - 4} more</span>}
              </div>
            );
          })}
        </div>

        <div className="cal-list">
          {!monthEvents.length ? <div className="empty">No events this month.</div> : (
            <ul className="list">
              {monthEvents.map((e, i) => (
                <li key={i}>
                  <span className="when">{e.date.slice(5, 10)}</span>
                  <span style={{ flex: 1 }}>
                    {e.symbol && <Link to={`/s/${encodeURIComponent(e.symbol)}`}><b>{e.symbol}</b></Link>} {e.title}
                  </span>
                  <span className={`chip ${e.type === "earnings" ? "accent" : ""}`}>{e.type}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="small muted">
          Company dates (earnings, dividends, splits, AGMs) come from the twice-daily data refresh; macro dates (Fed, CPI) from the built-in list. Add your own below, e.g.
          token unlocks or a shareholder meeting.
        </p>
      </div>

      <div className="card">
        <h2>Add your own event</h2>
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          if (!ev.date || !ev.title) return;
          mutate((s) => s.saveCustomEvent({ id: uid(), date: ev.date, title: ev.title, type: ev.type, symbol: ev.symbol.trim().toUpperCase() || null }));
          setEv({ date: "", title: "", symbol: "", type: "custom" });
        }}>
          <input type="date" value={ev.date} onChange={(e) => setEv({ ...ev, date: e.target.value })} aria-label="Date" />
          <input placeholder="Ticker (optional)" value={ev.symbol} onChange={(e) => setEv({ ...ev, symbol: e.target.value })} style={{ width: 130 }} />
          <input placeholder="What happens, e.g. PENDLE token unlock" value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
          <select value={ev.type} onChange={(e) => setEv({ ...ev, type: e.target.value })} aria-label="Type">
            {["custom", "unlock", "agm", "earnings", "dividend", "macro"].map((t) => <option key={t}>{t}</option>)}
          </select>
          <button className="primary">Add</button>
        </form>
        {d.customEvents.length > 0 && (
          <ul className="list" style={{ marginTop: 8 }}>
            {[...d.customEvents].sort((a, b) => a.date.localeCompare(b.date)).map((e) => (
              <li key={e.id}>
                <span className="when">{e.date}</span>
                <span style={{ flex: 1 }}>{e.symbol && <b>{e.symbol} </b>}{e.title}</span>
                <span className="chip">{e.type}</span>
                <button className="ghost danger" onClick={() => mutate((s) => s.deleteCustomEvent(e.id))} aria-label="Delete event">✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
