import { Link } from "react-router-dom";
import { useApp } from "../data/AppContext";
import { Kpi } from "../components/common";
import { allocation } from "../lib/portfolio";
import { activityFeed, headlines, upcomingEvents } from "../lib/activity";
import { ago, compact, money, pct } from "../lib/format";
import { claudeCase, recentClaudeChanges } from "../lib/valuation";

const LABELS: Record<string, string> = { stock: "Stocks", bank: "Banks", insurer: "Insurers", reit: "REITs", etf: "ETFs", crypto: "Crypto", bond: "Bonds", cash: "Cash" };

function Alloc({ title, rows }: { title: string; rows: { key: string; valueSgd: number; pct: number }[] }) {
  return (
    <div>
      <h3>{title}</h3>
      {rows.map((r) => (
        <div className="alloc" key={r.key}>
          <span>{LABELS[r.key] ?? r.key}</span>
          <div className="bar"><div style={{ width: `${(r.pct * 100).toFixed(1)}%` }} /></div>
          <span className="num small">{pct(r.pct, 0)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { data, holdings, totals, loadSample, store, mutate } = useApp();
  const d = data!;
  const open = holdings.filter((h) => h.qty > 0);
  const symbols = [...new Set([...open.map((h) => h.symbol), ...d.watchlist])];
  const events = upcomingEvents(symbols, d.market, d.macro, d.customEvents, 45);
  const activity = activityFeed(symbols, d.market);
  const news = headlines(symbols, d.market, 12);
  const unread = d.alerts.filter((a) => !a.read);
  const claudeChanges = recentClaudeChanges(symbols, 10);
  const notResearched = symbols.filter((s) => !claudeCase(s) && d.market[s]?.assetClass !== "crypto" && d.market[s]?.assetClass !== "cash");
  const lastUpdate = Object.values(d.market).map((m) => m.updatedAt).sort().pop();

  if (!holdings.length && !d.watchlist.length)
    return (
      <div className="card empty stack">
        <h2>Welcome</h2>
        <p>Add your first trade, import a broker CSV, or load a sample portfolio to look around.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link to="/trades"><button className="primary">Add trades</button></Link>
          <button onClick={loadSample}>Load sample portfolio</button>
        </div>
      </div>
    );

  return (
    <div className="stack">
      <div className="grid kpis">
        <Kpi label="Portfolio value" value={`S$${money(totals.valueSgd, undefined, 0)}`} sub={`${money(totals.dayChangeSgd, undefined, 0)} (${pct(totals.dayChangePct, 2, true)}) today`} subTone={totals.dayChangeSgd} />
        <Kpi label="Unrealised P&L" value={`S$${money(totals.unrealizedSgd, undefined, 0)}`} sub={pct(totals.costSgd ? totals.unrealizedSgd / totals.costSgd : null, 1, true)} subTone={totals.unrealizedSgd} />
        <Kpi label="Realised + dividends" value={`S$${money(totals.realizedSgd + totals.dividendsSgd, undefined, 0)}`} sub={`dividends S$${money(totals.dividendsSgd, undefined, 0)}`} />
        <Kpi label="Prices updated" value={ago(lastUpdate)} sub={store.mode === "local" ? "bundled snapshot" : "5:30 PM and 6 AM SGT"} />
      </div>

      {unread.length > 0 && (
        <div className="card">
          <div className="row between">
            <h2>Alerts</h2>
            <button className="ghost" onClick={() => mutate((s) => s.markAlertsRead(unread.map((a) => a.id)))}>Mark all read</button>
          </div>
          <ul className="list">
            {unread.slice(0, 10).map((a) => (
              <li key={a.id}>
                <span className="when">{a.created_at.slice(5, 10)}</span>
                <span>{a.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="row between">
          <h2>From Claude's weekly research</h2>
          <Link to="/calendar" className="small">Open calendar →</Link>
        </div>
        {!claudeChanges.length ? (
          <div className="empty">No Claude research yet for your stocks.</div>
        ) : (
          <ul className="list">
            {claudeChanges.map((c, i) => (
              <li key={i}>
                <span className="when">{c.date.slice(5)}</span>
                <span style={{ flex: 1 }}><Link to={`/s/${encodeURIComponent(c.symbol)}`}><b>{c.symbol}</b></Link> <span className="small">{c.text}</span></span>
              </li>
            ))}
          </ul>
        )}
        {notResearched.length > 0 && <p className="small muted">Not researched yet (added at the next Sunday run): {notResearched.join(", ")}</p>}
      </div>

      <div className="grid two">
        <div className="card">
          <div className="row between">
            <h2>Upcoming events · next 45 days</h2>
            <Link to="/calendar" className="small">Calendar →</Link>
          </div>
          {!events.length ? (
            <div className="empty">No scheduled events found.</div>
          ) : (
            <ul className="list">
              {events.slice(0, 15).map((e, i) => (
                <li key={i}>
                  <span className="when">{e.days === 0 ? "today" : `${e.days}d`}</span>
                  <span style={{ flex: 1 }}>
                    {e.symbol && <Link to={`/s/${encodeURIComponent(e.symbol)}`}><b>{e.symbol}</b></Link>} {e.title}
                    <span className="muted small"> · {e.date}</span>
                  </span>
                  <span className={`chip ${e.type === "earnings" ? "accent" : ""}`}>{e.type}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <Alloc title="By asset class" rows={allocation(open, (h) => h.assetClass)} />
          <div style={{ height: 12 }} />
          <Alloc title="By platform" rows={allocation(open.flatMap((h) => h.platforms.filter((p) => p.qty > 0)), (p) => p.platform)} />
          <div style={{ height: 12 }} />
          <Alloc title="By currency" rows={allocation(open, (h) => h.currency)} />
        </div>
      </div>

      <div className="grid halves">
        <div className="card">
          <h2>Large trades: insiders, funds, big moves</h2>
          {!activity.length ? (
            <div className="empty">Nothing notable in the last 60 days.</div>
          ) : (
            <ul className="list">
              {activity.slice(0, 15).map((a, i) => (
                <li key={i}>
                  <span className="when">{a.date?.slice(5)}</span>
                  <span style={{ flex: 1 }}>
                    <Link to={`/s/${encodeURIComponent(a.symbol)}`}><b>{a.symbol}</b></Link> <span className="small">{a.text}</span>
                    {a.value ? <span className="muted small"> · {compact(a.value)}</span> : null}
                  </span>
                  <span className={`chip ${a.direction === "buy" ? "accent" : a.direction === "sell" ? "warn" : ""}`}>{a.kind}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="small muted">Insider and 13F data cover US listings. Crypto whale transfers need a paid feed and are not included.</p>
        </div>
        <div className="card">
          <h2>Headlines</h2>
          {!news.length ? (
            <div className="empty">No headlines.</div>
          ) : (
            <ul className="list">
              {news.map((n, i) => (
                <li key={i}>
                  <span className="when">{n.symbol}</span>
                  <span>
                    <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a>
                    <span className="muted small"> · {n.publisher} {n.time ? `· ${n.time.slice(0, 10)}` : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
