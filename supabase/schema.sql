-- Stock Intelligence Dashboard: Supabase schema (free tier).
-- Run once in Supabase > SQL Editor. Then insert your Google email into app_owner (bottom of file).
-- Only the email in app_owner can read or write anything. The GitHub Actions data job uses the
-- service-role key, which bypasses these policies.

create extension if not exists pgcrypto;

create table if not exists app_owner (email text primary key);
alter table app_owner enable row level security;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_owner where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

-- Trades and cash flows. Quantities are positive; `type` decides the direction.
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  type text not null check (type in ('buy','sell','dividend','fee','deposit','withdrawal')),
  trade_date date not null,
  quantity numeric not null default 0,
  price numeric not null default 0,          -- per unit, trading currency (dividend/fee: total amount with quantity 1)
  currency text not null default 'USD',
  fx_to_sgd numeric,                          -- SGD per 1 unit of currency on trade date; job back-fills if blank
  fees numeric not null default 0,            -- trading currency
  platform text not null default 'Tiger',
  note text,
  import_ref text unique,                     -- broker order id / hash, stops double imports
  created_at timestamptz not null default now()
);
alter table app_owner enable row level security;
create index if not exists transactions_symbol on transactions(symbol);

create table if not exists watchlist (
  symbol text primary key,
  added_at timestamptz not null default now()
);
alter table watchlist enable row level security;

-- Per-instrument settings: manual prices for cash/bonds, user 5y targets for crypto/ETFs, asset class overrides.
create table if not exists instruments (
  symbol text primary key,
  name text,
  asset_class text,
  currency text,
  manual_price numeric,
  manual_price_date date,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table instruments enable row level security;

-- Valuation assumptions the user edited (per scenario), probabilities, comps, and the baseline at edit time.
create table if not exists valuations (
  symbol text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table valuations enable row level security;

create table if not exists notes (
  symbol text primary key,
  thesis text not null default '',
  updated_at timestamptz not null default now()
);
alter table notes enable row level security;

create table if not exists journal (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  entry_date date not null default current_date,
  tags text[] not null default '{}',
  body text not null,
  created_at timestamptz not null default now()
);
alter table journal enable row level security;
create index if not exists journal_symbol on journal(symbol, entry_date desc);

create table if not exists custom_events (
  id uuid primary key default gen_random_uuid(),
  symbol text,
  date date not null,
  type text not null default 'custom',
  title text not null
);
alter table custom_events enable row level security;

-- Written by the data job.
create table if not exists market_data (
  symbol text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table market_data enable row level security;

create table if not exists reference_data (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table reference_data enable row level security;

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  symbol text,
  kind text not null,
  message text not null,
  dedupe_key text unique not null,
  created_at timestamptz not null default now(),
  read boolean not null default false
);
alter table alerts enable row level security;

-- Row level security: owner only.
do $$
declare t text;
begin
  foreach t in array array['app_owner','transactions','watchlist','instruments','valuations','notes','journal','custom_events','market_data','reference_data','alerts']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists owner_all on %I', t);
    if t = 'app_owner' then
      execute format('create policy owner_all on %I for select using (is_owner())', t);
    else
      execute format('create policy owner_all on %I for all using (is_owner()) with check (is_owner())', t);
    end if;
  end loop;
end $$;

-- >>> Replace with the Google account you will sign in with, then run this line:
-- insert into app_owner(email) values ('you@gmail.com');
