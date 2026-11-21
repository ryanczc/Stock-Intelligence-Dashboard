import { useMemo, useState } from "react";
import { useApp } from "../data/AppContext";
import type { ScenarioName, ValuationSettings } from "../lib/types";
import { DEFAULT_PROBABILITIES, MODEL_LABELS, SCENARIOS, scenarioDefaults, type ModelId, type Valuation } from "../lib/valuation";
import { FIELDS, type FieldMeta } from "../lib/valuation/fields";
import { compact, money, num, pct } from "../lib/format";

const SCN_LABEL: Record<ScenarioName, string> = { bear: "Bear", base: "Base", bull: "Bull" };

function show(meta: FieldMeta, v: number | undefined, ccy: string) {
  if (v == null || !Number.isFinite(v)) return "–";
  if (meta.kind === "pct") return pct(v, 2);
  if (meta.kind === "money") return Math.abs(v) >= 1e5 ? compact(v, ccy) : money(v, ccy);
  if (meta.kind === "x") return num(v, 2) + "x";
  if (meta.kind === "int") return String(Math.round(v));
  return Math.abs(v) >= 1e5 ? compact(v) : num(v, 4);
}
const toInput = (meta: FieldMeta, v: number) => (meta.kind === "pct" ? +(v * 100).toFixed(4) : v);
const fromInput = (meta: FieldMeta, s: string) => (s.trim() === "" ? null : meta.kind === "pct" ? Number(s) / 100 : Number(s));

export function ValuationPanel({ symbol, v, settings }: { symbol: string; v: Valuation; settings: ValuationSettings | undefined }) {
  const { mutate, data } = useApp();
  const [scn, setScn] = useState<ScenarioName>("base");
  const [advanced, setAdvanced] = useState(false);
  const model = v.model;
  const fields = FIELDS[model].filter((f) => advanced || !f.advanced);
  const rep = v.defaults.context.reportingCurrency;
  const trd = v.defaults.context.tradingCurrency;
  const s: ValuationSettings = settings ?? { overrides: {}, probabilities: DEFAULT_PROBABILITIES };
  const res = v.results[scn];
  const industries = useMemo(() => Object.keys(data?.reference?.industries?.Global ?? data?.reference?.industries?.US ?? {}).sort(), [data]);

  const save = (next: ValuationSettings) => mutate((st) => st.saveValuation(symbol, next));

  const setField = (key: string, value: number | null) => {
    const ov = { ...(s.overrides[scn] ?? {}) };
    const baseline = { ...(s.baselineAtEdit ?? {}) };
    if (value == null || !Number.isFinite(value)) {
      delete ov[key];
      if (scn === "base") delete baseline[key];
    } else {
      ov[key] = value;
      if (scn === "base") baseline[key] = v.defaults.inputs[key];
    }
    save({ ...s, overrides: { ...s.overrides, [scn]: ov }, baselineAtEdit: baseline });
  };

  /** Default shown for the current scenario: computed default for base, base +/- scenario adjustment otherwise. */
  const scenarioDefault = (key: string) => {
    if (scn === "base") return v.defaults.inputs[key];
    const adj = scenarioDefaults(model, v.inputs.base, scn)[key];
    return adj ?? v.inputs.base[key];
  };

  const groups = [...new Set(fields.map((f) => f.group))];

  return (
    <div className="stack">
      {v.drift.length > 0 && (
        <div className="banner small">
          <b>New data suggests revisiting your assumptions.</b>{" "}
          {v.drift.map((d) => {
            const meta = FIELDS[model].find((f) => f.key === d.field)!;
            return (
              <span key={d.field} style={{ marginRight: 12 }}>
                {meta?.label ?? d.field}: default was {show(meta, d.whenEdited, rep)} when you edited, now {show(meta, d.now, rep)}{" "}
                <button className="ghost" onClick={() => save({ ...s, baselineAtEdit: { ...s.baselineAtEdit, [d.field]: d.now } })}>
                  keep mine
                </button>
                <button className="ghost" onClick={() => setField(d.field, null)}>use new</button>
              </span>
            );
          })}
        </div>
      )}
      {v.defaults.missing.length > 0 && <div className="banner small">Missing from free data: {v.defaults.missing.join(", ")}. Enter these below.</div>}

      <div className="grid kpis">
        {SCENARIOS.map((x) => (
          <div className="card kpi" key={x}>
            <div className="label">{SCN_LABEL[x]} · {pct(v.probabilities[x], 0)}</div>
            <div className="value">{money(v.results[x].valuePerShare)}</div>
            <div className="sub muted">{trd} per share</div>
          </div>
        ))}
        <div className="card kpi">
          <div className="label">Probability-weighted value</div>
          <div className="value">{money(v.weightedValue)}</div>
          <div className={`sub ${v.upside != null && v.upside > 0 ? "pos" : "neg"}`}>{pct(v.upside, 1, true)} vs {money(v.price)}</div>
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <h2>{MODEL_LABELS[model]}</h2>
          <div className="row small">
            <label className="field">
              Model
              <select value={s.model ?? ""} onChange={(e) => save({ ...s, model: e.target.value || undefined, overrides: {} })}>
                <option value="">Automatic ({MODEL_LABELS[v.defaults.model].split(" (")[0]})</option>
                {(Object.keys(MODEL_LABELS) as ModelId[]).map((m) => <option key={m} value={m}>{MODEL_LABELS[m]}</option>)}
              </select>
            </label>
            <label className="field">
              Damodaran industry
              <select value={s.industry ?? ""} onChange={(e) => save({ ...s, industry: e.target.value || undefined })}>
                <option value="">Automatic ({v.defaults.context.industry})</option>
                {industries.map((i) => <option key={i}>{i}</option>)}
              </select>
            </label>
          </div>
        </div>
        <p className="small muted">
          Years 1-5 high growth, years 6-10 linear fade to stable growth, terminal value after year 10. Inputs in {rep}
          {rep !== trd ? `, converted to ${trd} at ${num(v.inputs.base.fxReportingToTrading, 4)}` : ""}. Risk-free {pct(v.defaults.context.riskFree, 2)}, ERP{" "}
          {pct(v.defaults.context.erp, 2)}, country risk premium {pct(v.defaults.context.crp, 2)} ({v.defaults.context.country})
          {v.defaults.context.leveredBeta != null ? `, beta ${num(v.defaults.context.leveredBeta, 2)}` : ""}
          {v.defaults.context.rating ? `, synthetic rating ${v.defaults.context.rating}` : ""}. Industry data: {v.defaults.context.industrySource}.
        </p>

        <div className="row between" style={{ margin: "12px 0" }}>
          <div className="seg" role="tablist">
            {SCENARIOS.map((x) => (
              <button key={x} className={scn === x ? "active" : ""} onClick={() => setScn(x)}>{SCN_LABEL[x]}</button>
            ))}
          </div>
          <div className="row small">
            <span className="muted">Probabilities</span>
            {SCENARIOS.map((x) => (
              <label key={x} className="row" style={{ gap: 4 }}>
                {SCN_LABEL[x]}
                <input
                  className="cell"
                  style={{ width: 64 }}
                  type="number"
                  step="5"
                  defaultValue={Math.round((s.probabilities?.[x] ?? DEFAULT_PROBABILITIES[x]) * 100)}
                  onBlur={(e) => save({ ...s, probabilities: { ...(s.probabilities ?? DEFAULT_PROBABILITIES), [x]: Number(e.target.value) / 100 } })}
                />
                %
              </label>
            ))}
          </div>
        </div>
        {scn !== "base" && (
          <p className="small muted">The {SCN_LABEL[scn].toLowerCase()} case starts from your base case with {model === "fcff" ? "growth and target margin" : model === "excessReturn" ? "ROE" : "growth"} adjusted. Override anything below.</p>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Assumption</th>
                <th className="num">Default</th>
                <th className="num">Your value</th>
                <th>Source</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g}>
                <tr><td colSpan={4} className="muted small" style={{ paddingTop: 14 }}><b>{g}</b></td></tr>
                {fields.filter((f) => f.group === g).map((f) => {
                  const ov = s.overrides[scn]?.[f.key];
                  const def = scenarioDefault(f.key);
                  return (
                    <tr key={f.key + scn}>
                      <td><span className="tip" title={f.help}>{f.label}</span></td>
                      <td className="num">{show(f, def, rep)}</td>
                      <td className="num">
                        <input
                          className={`cell ${ov != null ? "override" : ""}`}
                          type="number"
                          step="any"
                          placeholder={Number.isFinite(def) ? String(toInput(f, def)) : ""}
                          defaultValue={typeof ov === "number" ? toInput(f, ov) : ""}
                          onBlur={(e) => {
                            const val = fromInput(f, e.target.value);
                            if (val !== (typeof ov === "number" ? ov : null)) setField(f.key, val);
                          }}
                          aria-label={f.label}
                        />
                        {f.kind === "pct" && <span className="muted small"> %</span>}
                      </td>
                      <td className="small muted">{v.defaults.sources[f.key] ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="ghost" onClick={() => setAdvanced(!advanced)}>{advanced ? "Hide" : "Show"} advanced inputs</button>
          <button className="ghost danger" onClick={() => save({ ...s, overrides: { ...s.overrides, [scn]: {} }, baselineAtEdit: scn === "base" ? {} : s.baselineAtEdit })}>
            Reset {SCN_LABEL[scn].toLowerCase()} case to defaults
          </button>
        </div>
      </div>

      <div className="card">
        <h2>{SCN_LABEL[scn]} case projection ({rep})</h2>
        {res.warnings.map((w) => <div key={w} className="banner small">{w}</div>)}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Year</th>
                {res.years.map((y) => <th key={y.year} className="num">{y.year}</th>)}
                <th className="num">Terminal</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Growth" vals={res.years.map((y) => pct(y.growth))} term={pct(res.terminal.growth)} />
              {model === "fcff" && (
                <>
                  <Row label="Revenue" vals={res.years.map((y) => compact(y.revenue))} />
                  <Row label="Operating margin" vals={res.years.map((y) => pct(y.margin))} />
                  <Row label="EBIT" vals={res.years.map((y) => compact(y.ebit))} />
                  <Row label="Tax rate" vals={res.years.map((y) => pct(y.taxRate))} />
                  <Row label="Reinvestment" vals={res.years.map((y) => compact(y.reinvestment))} />
                  <Row label="FCFF" vals={res.years.map((y) => compact(y.cashFlow))} term={compact(res.terminal.cashFlow)} />
                  <Row label="EPS" vals={res.years.map((y) => num(y.eps))} />
                </>
              )}
              {model === "excessReturn" && (
                <>
                  <Row label="ROE" vals={res.years.map((y) => pct(y.roe))} />
                  <Row label="Book value / share" vals={res.years.map((y) => num(y.bvps))} />
                  <Row label="EPS" vals={res.years.map((y) => num(y.eps))} />
                  <Row label="Dividend / share" vals={res.years.map((y) => num(y.dps))} />
                  <Row label="Excess return / share" vals={res.years.map((y) => num(y.cashFlow, 3))} term={num(res.terminal.cashFlow, 3)} />
                </>
              )}
              {model === "reitDdm" && (
                <>
                  <Row label="FFO / unit" vals={res.years.map((y) => num(y.ffoPerShare, 4))} />
                  <Row label="Distribution / unit" vals={res.years.map((y) => num(y.dps, 4))} term={num(res.terminal.cashFlow, 4)} />
                </>
              )}
              <Row label="Discount rate" vals={res.years.map((y) => pct(y.discountRate, 2))} term={pct(res.terminal.discountRate, 2)} />
              <Row label="Present value" vals={res.years.map((y) => (model === "fcff" ? compact(y.pv) : num(y.pv, 3)))} term={model === "fcff" ? compact(res.terminal.pv) : num(res.terminal.pv, 3)} />
            </tbody>
          </table>
        </div>
        <h3 style={{ marginTop: 16 }}>Value bridge</h3>
        <table style={{ maxWidth: 520 }}>
          <tbody>
            {res.breakdown.map((b) => (
              <tr key={b.label}>
                <td>{b.label}</td>
                <td className="num">{model === "fcff" ? compact(b.value, rep) : money(b.value, rep)}</td>
              </tr>
            ))}
            <tr>
              <td><b>Value per share ({trd})</b></td>
              <td className="num"><b>{money(res.valuePerShare, trd)}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, vals, term }: { label: string; vals: string[]; term?: string }) {
  return (
    <tr>
      <td className="small" style={{ whiteSpace: "nowrap" }}>{label}</td>
      {vals.map((v, i) => <td key={i} className="num small">{v}</td>)}
      <td className="num small">{term ?? ""}</td>
    </tr>
  );
}
