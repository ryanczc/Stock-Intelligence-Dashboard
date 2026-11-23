-- Run once in Supabase > SQL Editor to add the decision journal (safe to run more than once).
create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  decision_date date not null default current_date,
  action text not null check (action in ('buy','add','trim','sell','pass')),
  price numeric not null,
  thesis text not null default '',
  target_price numeric,
  stop_price numeric,
  conviction int check (conviction between 1 and 5),
  horizon_months int,
  dcf_value numeric,
  review text,
  outcome text,
  reviewed_at date,
  created_at timestamptz not null default now()
);
create index if not exists decisions_symbol on decisions(symbol, decision_date desc);
alter table decisions enable row level security;
drop policy if exists owner_all on decisions;
create policy owner_all on decisions for all using (is_owner()) with check (is_owner());
grant select, insert, update, delete on decisions to authenticated, service_role;
