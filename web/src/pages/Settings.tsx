import { useApp } from "../data/AppContext";
import { LocalStore, supabase } from "../data/store";
import { ago, num, pct } from "../lib/format";

const REPO = "https://github.com/ryanczc/stock-intelligence-dashboard";

export default function Settings() {
  const { store, data, session, reload, loadSample } = useApp();
  const d = data!;
  const ref = d.reference;
  const local = store instanceof LocalStore ? store : null;

  const download = () => {
    const blob = new Blob([local!.exportJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stock-intel-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <div className="card stack">
        <h2>Account and data</h2>
        {store.mode === "supabase" ? (
          <div className="row between">
            <span>Signed in as <b>{session?.user.email}</b>. Data is stored in your Supabase project.</span>
            <button onClick={() => supabase!.auth.signOut()}>Sign out</button>
          </div>
        ) : (
          <>
            <p>
              <b>Preview mode.</b> Entries are kept in this browser only. To get live twice-daily prices, Telegram alerts, Google sign-in and the same data on phone and
              computer, follow the <a href={`${REPO}/blob/main/docs/SETUP.md`} target="_blank" rel="noreferrer">setup guide</a> (about 20 minutes, all free tiers).
            </p>
            <div className="row">
              <button onClick={download}>Download backup (JSON)</button>
              <label className="btn">
                Restore backup
                <input type="file" accept="application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { local!.importJson(await f.text()); await reload(); } }} />
              </label>
              <button onClick={loadSample}>Load sample portfolio</button>
              <button className="danger" onClick={() => { if (window.confirm("Clear everything stored in this browser?")) { localStorage.removeItem("sid:v1"); reload(); } }}>Clear local data</button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2>Market data status</h2>
        <table>
          <tbody>
            <tr><td>Symbols with data</td><td className="num">{Object.keys(d.market).length}</td></tr>
            <tr><td>FX rates (SGD per unit)</td><td className="num">{Object.entries(d.fx).filter(([k]) => k !== "SGD").map(([k, v]) => `${k} ${num(v, 4)}`).join(" · ")}</td></tr>
            <tr><td>FX updated</td><td className="num">{ago(d.fxUpdatedAt)}</td></tr>
            <tr><td>Damodaran datasets</td><td className="num">{ref?.updatedAt ? ago(ref.updatedAt) : "built-in fallback"}</td></tr>
            <tr><td>Mature market ERP · US risk-free</td><td className="num">{pct(ref?.erp, 2)} · {pct(ref?.riskFree?.USD, 2)}</td></tr>
            <tr><td>Country risk premiums</td><td className="num">{["Singapore", "Hong Kong", "China"].map((c) => `${c} ${pct(ref?.countries?.[c]?.crp, 2)}`).join(" · ")}</td></tr>
          </tbody>
        </table>
        <p className="small muted">
          Prices refresh at about 5:30 PM SGT (after SGX and HKEX close) and 6 AM SGT (after the US close) on weekdays, via the free GitHub Actions job. To refresh now, open{" "}
          <a href={`${REPO}/actions/workflows/update-data.yml`} target="_blank" rel="noreferrer">the workflow</a> and press "Run workflow".
        </p>
      </div>

      <div className="card">
        <h2>What the free data covers</h2>
        <ul className="small">
          <li>Prices, FX, financial statements, analyst growth estimates, earnings and dividend dates, news headlines: Yahoo Finance (US, SGX, HKEX, crypto).</li>
          <li>Insider trades and 13F institutional holders: US listings only.</li>
          <li>ERP, country risk premiums, industry betas, margins, sales-to-capital and multiples: Damodaran Online, refreshed weekly.</li>
          <li>Fed and CPI dates: maintained in <code>pipeline/config/macro_events.json</code>.</li>
          <li>Not covered for free: crypto whale transfers, token unlock schedules (add them as events on the coin's page), SGX/HKEX director dealings, reported REIT FFO.</li>
        </ul>
      </div>
    </div>
  );
}
