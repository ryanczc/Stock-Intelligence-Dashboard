import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../data/AppContext";
import { uid } from "../data/store";
import { PLATFORMS, type Transaction, type TxType } from "../lib/types";
import { FIELDS, PRESETS, autoMap, parseCsv, toDrafts, normaliseSymbol, type Draft, type Field } from "../lib/csvImport";
import { money, num } from "../lib/format";

const today = () => new Date().toISOString().slice(0, 10);
const CCY = ["USD", "SGD", "HKD", "CNY", "EUR"];

function guessCurrency(sym: string) {
  if (sym.endsWith(".SI") || /^CASH-SGD/.test(sym)) return "SGD";
  if (sym.endsWith(".HK")) return "HKD";
  return "USD";
}

function TradeForm() {
  const { mutate, data } = useApp();
  const blank = { symbol: "", type: "buy" as TxType, trade_date: today(), quantity: "", price: "", currency: "USD", fx_to_sgd: "", fees: "", platform: "Tiger", note: "" };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof blank, v: string) => {
    const next = { ...f, [k]: v };
    if (k === "symbol") {
      next.symbol = v.toUpperCase();
      next.currency = data!.market[normaliseSymbol(v)]?.currency ?? guessCurrency(next.symbol);
      if (next.symbol.endsWith("-USD")) next.platform = "Crypto";
    }
    if (k === "currency" && v === "SGD") next.fx_to_sgd = "1";
    setF(next);
  };
  const isAmount = f.type === "dividend" || f.type === "fee";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sym = f.symbol.trim().toUpperCase();
    const q = isAmount ? 1 : Number(f.quantity);
    const p = Number(f.price);
    if (!sym || !(q > 0) || !(p >= 0)) return setMsg("Symbol, quantity and price are required.");
    const tx: Transaction = {
      id: uid(), symbol: sym, type: f.type, trade_date: f.trade_date, quantity: q, price: p, currency: f.currency,
      fx_to_sgd: f.currency === "SGD" ? 1 : f.fx_to_sgd ? Number(f.fx_to_sgd) : null, fees: Number(f.fees) || 0, platform: f.platform, note: f.note || null,
    };
    await mutate((s) => s.upsertTransactions([tx]));
    setMsg(`Saved ${f.type} ${sym}.`);
    setF({ ...blank, platform: f.platform, trade_date: f.trade_date });
  };
  const fxHint = f.currency !== "SGD" && data!.fx[f.currency] ? `today ${num(data!.fx[f.currency], 4)}` : "";
  return (
    <form className="card" onSubmit={submit}>
      <h2>Add a trade</h2>
      <div className="form-grid">
        <label className="field">Type
          <select value={f.type} onChange={(e) => set("type", e.target.value)}>
            <option value="buy">Buy</option><option value="sell">Sell</option><option value="dividend">Dividend received</option><option value="fee">Fee / charge</option>
            <option value="deposit">Cash deposit</option><option value="withdrawal">Cash withdrawal</option>
          </select>
        </label>
        <label className="field">Symbol<input required placeholder={f.type === "deposit" || f.type === "withdrawal" ? "CASH-SGD" : "AAPL, D05.SI, BTC-USD"} value={f.symbol} onChange={(e) => set("symbol", e.target.value)} /></label>
        <label className="field">Date<input type="date" required value={f.trade_date} onChange={(e) => set("trade_date", e.target.value)} /></label>
        {!isAmount && <label className="field">Quantity<input type="number" step="any" required value={f.quantity} onChange={(e) => set("quantity", e.target.value)} /></label>}
        <label className="field">{isAmount ? "Total amount" : f.type === "deposit" || f.type === "withdrawal" ? "Price (1 for cash)" : "Price per unit"}<input type="number" step="any" required value={f.price} onChange={(e) => set("price", e.target.value)} /></label>
        <label className="field">Currency<select value={f.currency} onChange={(e) => set("currency", e.target.value)}>{CCY.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field">Fees<input type="number" step="any" value={f.fees} onChange={(e) => set("fees", e.target.value)} placeholder="0" /></label>
        <label className="field">Platform<select value={f.platform} onChange={(e) => set("platform", e.target.value)}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select></label>
        {f.currency !== "SGD" && (
          <label className="field">SGD per {f.currency} on trade date<input type="number" step="any" value={f.fx_to_sgd} onChange={(e) => set("fx_to_sgd", e.target.value)} placeholder={`blank = auto (${fxHint})`} /></label>
        )}
        <label className="field">Note<input value={f.note} onChange={(e) => set("note", e.target.value)} /></label>
        <button className="primary">Save</button>
      </div>
      {msg && <p className="small muted">{msg}</p>}
      <p className="small muted">Leave the FX rate blank and the data job fills in that day's rate. For cash, record a deposit to a symbol like CASH-SGD or CASH-USD with price 1.</p>
    </form>
  );
}

function CsvImport() {
  const { mutate } = useApp();
  const [platform, setPlatform] = useState("Tiger");
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [map, setMap] = useState<Partial<Record<Field, string>>>({});
  const [ccy, setCcy] = useState("USD");
  const [done, setDone] = useState("");
  const drafts: Draft[] = useMemo(() => (parsed ? toDrafts(parsed.rows, map, platform, ccy) : []), [parsed, map, platform, ccy]);
  const ok = drafts.filter((d) => !d.error);

  const onFile = async (file: File) => {
    const p = parseCsv(await file.text());
    setParsed(p);
    setMap(autoMap(p.headers));
    setDone("");
  };
  const doImport = async () => {
    await mutate((s) => s.upsertTransactions(ok.map(({ error: _e, ...d }) => ({ ...d, id: uid() }))));
    setDone(`Imported ${ok.length} rows. Re-importing the same file will not create duplicates.`);
    setParsed(null);
  };

  return (
    <div className="card">
      <h2>Import broker CSV</h2>
      <div className="form-grid">
        <label className="field">Platform<select value={platform} onChange={(e) => setPlatform(e.target.value)}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label className="field">Default currency<select value={ccy} onChange={(e) => setCcy(e.target.value)}>{CCY.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field">CSV file<input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
      </div>
      <p className="small muted">{PRESETS[platform] ?? ""}. Columns are detected from the header row; check the mapping below before importing.</p>
      {done && <p className="small pos">{done}</p>}
      {parsed && (
        <div className="stack">
          <div className="form-grid">
            {FIELDS.map((fl) => (
              <label key={fl.key} className="field">{fl.label}{fl.required ? " *" : ""}
                <select value={map[fl.key] ?? ""} onChange={(e) => setMap({ ...map, [fl.key]: e.target.value || undefined })}>
                  <option value="">(none)</option>
                  {parsed.headers.map((h) => <option key={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="table-wrap" style={{ maxHeight: 360 }}>
            <table>
              <thead><tr><th>Date</th><th>Symbol</th><th>Type</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Fees</th><th>Ccy</th><th>Status</th></tr></thead>
              <tbody>
                {drafts.slice(0, 200).map((d, i) => (
                  <tr key={i}>
                    <td>{d.trade_date}</td><td>{d.symbol}</td><td>{d.type}</td><td className="num">{num(d.quantity, 4)}</td><td className="num">{money(d.price)}</td><td className="num">{money(d.fees)}</td><td>{d.currency}</td>
                    <td className={d.error ? "neg small" : "pos small"}>{d.error ?? "ok"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button className="primary" disabled={!ok.length} onClick={doImport}>Import {ok.length} rows</button>
            {drafts.length > ok.length && <span className="small warn">{drafts.length - ok.length} rows have problems and will be skipped.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Trades() {
  const { data, mutate } = useApp();
  const [filter, setFilter] = useState("");
  const txs = [...data!.transactions].sort((a, b) => b.trade_date.localeCompare(a.trade_date)).filter((t) => !filter || t.symbol.includes(filter.toUpperCase()) || t.platform.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="stack">
      <div className="grid halves">
        <TradeForm />
        <CsvImport />
      </div>
      <div className="card">
        <div className="row between">
          <h2>All transactions ({data!.transactions.length})</h2>
          <input placeholder="Filter by symbol or platform" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Symbol</th><th>Type</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Fees</th><th className="num">FX→SGD</th><th>Platform</th><th>Note</th><th /></tr></thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id}>
                  <td>{t.trade_date}</td>
                  <td><Link to={`/s/${encodeURIComponent(t.symbol)}`}>{t.symbol}</Link></td>
                  <td>{t.type}</td>
                  <td className="num">{num(t.quantity, 4)}</td>
                  <td className="num">{money(t.price)} <span className="muted small">{t.currency}</span></td>
                  <td className="num">{money(t.fees)}</td>
                  <td className="num">{t.fx_to_sgd ? num(t.fx_to_sgd, 4) : <span className="muted small">pending</span>}</td>
                  <td>{t.platform}</td>
                  <td className="small muted">{t.note}</td>
                  <td><button className="ghost danger" onClick={() => confirmDelete(t) && mutate((s) => s.deleteTransaction(t.id))} aria-label="Delete">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function confirmDelete(t: Transaction) {
  return window.confirm(`Delete ${t.type} ${t.symbol} on ${t.trade_date}?`);
}
