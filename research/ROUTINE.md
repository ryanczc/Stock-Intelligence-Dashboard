# Weekly Claude research routine

This file is the instruction set for the scheduled Claude task that runs every **Sunday morning (Singapore time)**.
Ryan's choices (22 Nov 2026): weekly only; Claude keeps a **separate** "Claude's thesis" and never edits Ryan's own
thesis or journal; every update goes out as a **pull request Ryan approves**; sources are free public sources plus
the sites listed in `research/sources.json`.

## What to research

1. `git fetch origin data main` and read `research/universe.json` from the `data` branch
   (`git show origin/data:research/universe.json`). It lists `holdings` and `watchlist` tickers and is refreshed by the
   twice-daily data job. If it is missing, use the tickers that already have a file in `web/src/data/research/`.
2. Research every ticker in `holdings` first, then `watchlist`. Skip cash and bond placeholders (e.g. `CASH-SGD`).
   A ticker on the list with no research file yet gets a new file.
3. Tickers ending in `-USD` are crypto tokens: write a thesis only and set `"noDcf": true` (no DCF inputs).
   Crypto-treasury companies (MSTR, BMNR) also keep `"noDcf": true`.

## Sources

- Free public sources: company results releases and investor-relations pages, SEC EDGAR filings (10-Q, 10-K, 8-K, 6-K,
  Form 4), SGX and HKEX announcements, and mainstream financial news.
- Also check every site in `research/sources.json` → `extraSites`.
- Use standard web search; at most about 3 searches and 2 page reads per ticker. Prefer primary sources (the company's
  own release or filing) for numbers.
- Record the pages you relied on in `sources` (title + URL, at most 5, newest first).

## What to update in `web/src/data/research/<TICKER>.json`

Keep the existing structure (see `NOW.json` as the example):

- `asOf`: today's date (YYYY-MM-DD).
- `summary`: 1-3 sentences on what the company is and the latest facts that drive the valuation.
- `base`, `bear`, `bull`: valuation inputs as decimals. Use only keys listed in `web/src/lib/valuation/fields.ts`
  for the stock's model (FCFF for operating companies, excess-return for banks and insurers, REIT model for REITs).
  Set rates and multiples only, never revenue, cash, debt or share counts, which come from the live data feed.
- `exitMetric` (usually `"pe"`) and `exitMultiple`: the multiple applied to year-5 earnings.
- `rationale`: one line per input you set, saying why, with the key number and its period.
- `thesis`: `text` (2-3 sentences), `bull`, `bear`, `watch` (2-4 short bullets each).
- `changes`: **add one entry at the top** dated today. It should say what changed and why, with old → new values,
  e.g. "Growth 18% → 20% after Q3 beat and raised guidance; exit P/E unchanged at 35x." If nothing material
  happened, write "No material change." Keep at most 20 entries (drop the oldest).
- Only change an assumption when there is new evidence (results, guidance, a deal, a big price move, a filing).
  Don't churn numbers week to week.

Never edit anything else: not Ryan's notes, journal, trades or settings (they live in Supabase, which this routine
can't reach), and not the app code. Never write secrets.

## Check, then open the pull request

1. `cd web && npm ci && npx vitest run src/lib/__tests__/claude.test.ts && npx tsc --noEmit -p .` must pass.
   If a test fails, fix your JSON (usually a misspelt input key).
2. Create the branch `research/weekly-YYYY-MM-DD` from `origin/main`, commit only `web/src/data/research/*.json`,
   and push.
3. Open a pull request to `main` titled `Weekly Claude research: YYYY-MM-DD`. The description is written for Ryan,
   who isn't technical:
   - a top section **"Needs your attention"** listing big changes: any exit multiple or growth/margin input moved by
     more than 15% (relative), a thesis point that broke (e.g. guidance cut, deal failed), or a new ticker;
   - a table: Ticker | What changed | Why | Source;
   - a last line: "Merge this pull request to publish the update on your dashboard."
4. Never merge the pull request yourself, and never push to `main`.
