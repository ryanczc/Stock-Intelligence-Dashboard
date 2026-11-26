# Stock Intelligence Dashboard

A private portfolio tracker and intelligence terminal for US, SGX, HKEX and crypto holdings, valued
Aswath Damodaran style. Runs entirely on free tiers: GitHub Pages (web app), GitHub Actions (data job),
Supabase (database + Google sign-in), Yahoo Finance and Damodaran Online (data), Telegram (alerts).

## What it does

- **Portfolio**: total value in SGD with day change, unrealised and realised P&L, dividends. Trades are
  entered with price, quantity, platform (Tiger, Syfe, Longbridge, Crypto) and FX at the trade date.
  One row per holding with weighted average cost, expandable per platform. Cash, ETFs, REITs, bonds.
- **Import**: broker CSV import with automatic column detection and a preview, plus a manual trade form.
- **Watchlist**: same valuation columns as holdings.
- **Every row**: average cost, current price, probability-weighted DCF value, upside, 5-year price target, CAGR (total return incl. dividends).
- **Valuation** (per stock, all assumptions editable, edits persist and are flagged when new data moves the default):
  - Operating companies: FCFF DCF. Years 1-5 high growth, years 6-10 linear fade to stable growth, terminal value after year 10.
    Bottom-up beta, ERP + country risk premium, synthetic rating cost of debt, sales-to-capital reinvestment, margin convergence, effective to marginal tax.
  - Banks and insurers: excess return model. REITs: FFO dividend discount model. Crypto/ETFs: your own target.
  - Bear / base / bull cases with editable probabilities.
  - 5-year target = year-5 EPS / FCF / EBITDA / book / FFO x exit multiple, picked per industry norm, from comps, Damodaran industry multiples and a growth-justified (DCF-implied) multiple.
- **Intelligence**: upcoming earnings, dividends, splits, Fed and CPI dates, your own events (AGMs, token unlocks);
  US insider trades and 13F fund moves; big price moves; news headlines. Alerts on the dashboard and in Telegram.
- **Notes**: a pinned thesis and a dated, tagged journal per stock (holdings and watchlist).

## Layout

| Path | What |
|---|---|
| `web/` | React + TypeScript app (Vite). Valuation engine in `web/src/lib/valuation/`. |
| `pipeline/` | Python data job: Yahoo Finance, Damodaran datasets, alerts, Telegram. |
| `supabase/schema.sql` | Database tables and owner-only row level security. |
| `.github/workflows/` | `update-data.yml` (5:30 PM and 6 AM SGT), `deploy.yml` (GitHub Pages), `ci.yml`. |

## Try it

```bash
cd web && npm install && npm run dev
```

Without Supabase configured, the app runs in preview mode with a bundled market snapshot and
browser storage. See [docs/SETUP.md](docs/SETUP.md) to go live.

## Tests

```bash
cd web && npm test            # valuation, holdings and CSV import
python -m pytest pipeline/tests
```

## Claude base case

`web/src/data/research/<SYMBOL>.json` holds researched default assumptions, a thesis and a change log per ticker (growth, margins, reinvestment,
risk, exit multiple), each with a one-line reason and a date. On a stock's page they replace the automatic
data defaults; anything you type in "Your value" overrides them, and clearing the box goes back to them.
A weekly Claude routine refreshes these files and opens a pull request (see `research/ROUTINE.md`); merging it redeploys the site.

## Portfolio-manager tools
- **Decisions** tab on each stock: log buy/add/trim/sell/pass with thesis, target, stop, conviction and horizon (your DCF value is
  saved with it). Write a post-mortem later. Needs `supabase/add-decisions.sql` run once in the Supabase SQL Editor.
- **Review** page: hit rate, returns vs targets and the Nasdaq, conviction vs results, and whether targets and DCF values run hot or cold.
- **Tripwires** tab on each stock: thresholds on revenue growth, margins, ROE, P/E, price, price vs DCF and drawdown. Checked live
  and after every data refresh (`pipeline/tripwires.py`); crossings show on the Dashboard and go to Telegram.
- **Risk** page: exposure by asset class, sector, country and currency; correlation matrix; beta to the Nasdaq and bitcoin
  (2-year weekly regression against benchmarks saved by the data job); stress tests (Nasdaq -20%, bitcoin -40%, USD/SGD -10%, combined).
