import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../data/AppContext";
import { Pct, Sparkline, SymbolCell, valuationCells } from "../components/common";
import { money, pct, tone } from "../lib/format";

export default function Holdings() {
  const { holdings, totals, valuation, data, loadSample } = useApp();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showClosed, setShowClosed] = useState(false);
  const rows = holdings.filter((h) => showClosed || h.qty > 0);

  if (!holdings.length)
    return (
      <div className="card empty stack">
        <p>No holdings yet. Add a trade or import a broker CSV.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link to="/trades"><button className="primary">Add trades</button></Link>
          <button onClick={loadSample}>Load a sample portfolio</button>
        </div>
      </div>
    );

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2>Holdings · SGD {money(totals.valueSgd, undefined, 0)}</h2>
        <label className="row small muted">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed positions
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="num">Qty</th>
              <th className="num">Avg cost</th>
              <th className="num">Price</th>
              <th className="num">Day</th>
              <th>1y</th>
              <th className="num">Value (SGD)</th>
              <th className="num">P&amp;L (SGD)</th>
              <th className="num">Weight</th>
              <th className="num"><span className="tip" title="Probability-weighted intrinsic value per share (bear/base/bull), trading currency">DCF value</span></th>
              <th className="num">Upside</th>
              <th className="num"><span className="tip" title="Year-5 metric x exit multiple, trading currency">5y target</span></th>
              <th className="num"><span className="tip" title="Total return CAGR to the 5y target, including projected dividends">CAGR</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const v = valuationCells(valuation(h.symbol), h.currency);
              const multi = h.platforms.length > 1;
              return (
                <Fragment key={h.symbol}>
                  <tr>
                    <SymbolCell
                      symbol={h.symbol}
                      name={h.name}
                      extra={
                        <span className="small muted">
                          <button className="expander" onClick={() => setOpen({ ...open, [h.symbol]: !open[h.symbol] })} aria-expanded={!!open[h.symbol]}>
                            {open[h.symbol] ? "▾" : "▸"} {multi ? `${h.platforms.length} platforms` : h.platforms[0]?.platform}
                          </button>
                          {v.flag && <span className="chip warn" title="New data suggests revisiting your assumptions">review</span>}
                        </span>
                      }
                    />
                    <td className="num">{h.qty.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                    <td className="num">{money(h.avgCost)}</td>
                    <td className="num">
                      {money(h.price)} <span className="muted small">{h.currency}</span>
                      {h.priceIsManual && <span className="chip">manual</span>}
                    </td>
                    <td className="num"><Pct x={h.dayChangePct} /></td>
                    <td><Sparkline points={data?.market[h.symbol]?.history} /></td>
                    <td className="num">{money(h.valueSgd, undefined, 0)}</td>
                    <td className={`num ${tone(h.unrealizedSgd)}`}>
                      {money(h.unrealizedSgd, undefined, 0)}
                      <div className="small">{pct(h.unrealizedPct, 1, true)}</div>
                    </td>
                    <td className="num">{pct(totals.valueSgd ? h.valueSgd / totals.valueSgd : null)}</td>
                    <td className="num">{v.dcf}</td>
                    <td className="num"><Pct x={v.upside} /></td>
                    <td className="num">{v.target}</td>
                    <td className="num"><Pct x={v.cagr} /></td>
                  </tr>
                  {open[h.symbol] &&
                    h.platforms.map((p) => (
                      <tr className="sub" key={p.platform}>
                        <td className="sym">{p.platform}</td>
                        <td className="num">{p.qty.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                        <td className="num">{money(p.avgCost)}</td>
                        <td className="num" colSpan={3}>
                          <span className="muted small">realised </span>
                          <span className={tone(p.realized)}>{money(p.realized)}</span>
                          <span className="muted small"> · dividends </span>
                          {money(p.dividends)}
                          <span className="muted small"> · fees </span>
                          {money(p.fees)}
                        </td>
                        <td className="num">{money(p.valueSgd, undefined, 0)}</td>
                        <td className={`num ${tone(p.valueSgd - p.costSgd)}`}>{p.qty > 0 ? money(p.valueSgd - p.costSgd, undefined, 0) : "–"}</td>
                        <td colSpan={5} />
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="sym"><b>Total</b></td>
              <td colSpan={5} className="num muted small">
                Realised {money(totals.realizedSgd, "SGD", 0)} · Dividends {money(totals.dividendsSgd, "SGD", 0)}
              </td>
              <td className="num"><b>{money(totals.valueSgd, undefined, 0)}</b></td>
              <td className={`num ${tone(totals.unrealizedSgd)}`}><b>{money(totals.unrealizedSgd, undefined, 0)}</b></td>
              <td colSpan={5} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="small muted">
        Average cost includes buy fees. SGD cost uses the FX rate on each trade date; P&amp;L in SGD includes currency moves. DCF value, target and CAGR are in each
        stock's trading currency.
      </p>
    </div>
  );
}
