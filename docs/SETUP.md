# Going live (free, about 20 minutes)

Everything below uses free tiers. You need accounts on Supabase and Google Cloud (for Google sign-in),
and optionally Telegram.

## 1. Supabase (database + login)

1. Create a project at https://supabase.com (free plan). Pick the Singapore region.
2. SQL Editor > New query > paste `supabase/schema.sql` > Run.
3. In the same editor run, with your Google address:
   `insert into app_owner(email) values ('you@gmail.com');`
   Only this email can read or write any data.
4. Project Settings > API Keys: note the **Project URL** and two keys. Either key style works:
   - new style: the **publishable** key (`sb_publishable_...`) and a **secret** key (`sb_secret_...`), or
   - legacy tab: the **anon public** key and the **service_role** key (Supabase retires these in 2027).
   Use the publishable/anon key as `SUPABASE_ANON_KEY` and the secret/service_role key as `SUPABASE_SERVICE_ROLE_KEY`.

## 2. Google sign-in

1. Google Cloud Console > APIs & Services > Credentials > Create OAuth client ID (Web application).
2. Authorised redirect URI: `https://<your-project>.supabase.co/auth/v1/callback`.
3. Supabase > Authentication > Providers > Google: paste the client ID and secret, enable.
4. Supabase > Authentication > URL Configuration: set Site URL to
   `https://ryanczc.github.io/Stock-Intelligence-Dashboard/` and add it to Redirect URLs.

## 3. GitHub settings (this repository)

Settings > Secrets and variables > Actions:

| Kind | Name | Value |
|---|---|---|
| Secret | `SUPABASE_URL` | Project URL |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (never put this in the web app) |
| Secret | `TELEGRAM_BOT_TOKEN` | optional, see below |
| Secret | `TELEGRAM_CHAT_ID` | optional |
| Variable | `SUPABASE_URL` | Project URL |
| Variable | `SUPABASE_ANON_KEY` | anon public key (safe to expose; row level security protects data) |

Settings > Pages > Source: **GitHub Actions**. The site deploys on every push to `main`.

Actions > "Update market data" > Run workflow (tick "Force refresh of Damodaran datasets" the first time).
After that it runs by itself at about 5:30 PM SGT and 6 AM SGT on weekdays.

## 4. Telegram alerts (optional)

1. In Telegram, message @BotFather > `/newbot` > copy the token.
2. Send any message to your new bot, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
3. Save both as the secrets above.

Alerts: daily moves of 5% or more, events within 7 days (earnings, dividends, splits, your own events),
Fed/CPI within 2 days, US insider trades over $1M, 13F position changes of 20% or more. Each alert is sent once.

## Moving preview-mode data across

In preview mode, Settings > Download backup gives a JSON file of your trades, notes and assumptions.
(An import into Supabase can be added once you are live.)

## Notes on data

- Symbols are Yahoo Finance symbols: `D05.SI` (SGX), `0700.HK` (HKEX), `BTC-USD`.
- Broker CSV layouts vary: the importer detects columns by header name and lets you fix the mapping.
- Fed and CPI dates live in `pipeline/config/macro_events.json`. CPI dates for 2027 should be checked against the BLS schedule.
- Not available free: crypto whale transfers, token unlock schedules, SGX/HKEX director dealings, reported REIT FFO.
  Add events by hand on a stock's page; REIT FFO defaults to trailing distribution / 90%.
