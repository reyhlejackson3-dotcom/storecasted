-- Storecasted schema.
-- Run against a fresh Supabase project: supabase db push, or paste into the SQL editor.
--
-- Two things to notice:
--  * Every table has RLS on and a policy tied to auth.uid(). The cron job uses
--    the service-role key and bypasses these; the browser never can.
--  * Square access tokens are stored encrypted by the application before they
--    reach this table. The column holds ciphertext, never a usable token.

create extension if not exists "pgcrypto";

create table if not exists stores (
  id                     uuid primary key default gen_random_uuid(),
  owner_user_id          uuid not null references auth.users(id) on delete cascade,
  store_name             text not null default 'My store',
  square_merchant_id     text unique,
  square_access_token    text,          -- ciphertext, see src/lib/crypto.ts
  square_refresh_token   text,          -- ciphertext
  square_token_expires_at timestamptz,
  square_connected_at    timestamptz,
  -- set when Square reports INSUFFICIENT_SCOPES so the UI can prompt a reconnect
  square_needs_reconnect boolean not null default false,
  timezone               text not null default 'America/Denver',
  -- Billing is collected by hand for the first customers: send a Stripe
  -- payment link at trial end and flip this to 'active'. Wire up real
  -- subscriptions when doing it manually starts to hurt.
  subscription_status    text not null default 'trialing',
  trial_ends_at          timestamptz not null default (now() + interval '14 days'),
  created_at             timestamptz not null default now()
);

-- One row per item per day. This is the only place raw-ish data lives, and it
-- is re-derivable from Square at any time, so it can be truncated freely.
create table if not exists product_daily (
  store_id        uuid not null references stores(id) on delete cascade,
  square_item_id  text not null,
  day             date not null,
  units_sold      integer not null default 0,
  primary key (store_id, square_item_id, day)
);

create table if not exists products (
  store_id         uuid not null references stores(id) on delete cascade,
  square_item_id   text not null,
  name             text not null,
  category         text,
  price_cents      integer not null,
  unit_cost_cents  integer,             -- null when the seller never entered one
  stock            integer not null default 0,
  last_received_at date,
  returns_90d      integer not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (store_id, square_item_id)
);

create table if not exists store_daily (
  store_id     uuid not null references stores(id) on delete cascade,
  day          date not null,
  revenue_cents integer not null default 0,
  order_count  integer not null default 0,
  primary key (store_id, day)
);

create table if not exists briefings (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references stores(id) on delete cascade,
  day               date not null,
  items             jsonb not null,     -- BriefingItem[]
  -- audit trail: how many items came from each path, and why the model was
  -- rejected when it was. Lets you check cost and correctness later.
  template_count    integer not null default 0,
  llm_count         integer not null default 0,
  llm_fallback_note text,
  generated_at      timestamptz not null default now(),
  unique (store_id, day)
);

create index if not exists product_daily_lookup on product_daily (store_id, day desc);
create index if not exists store_daily_lookup   on store_daily   (store_id, day desc);
create index if not exists briefings_lookup     on briefings     (store_id, day desc);

alter table stores        enable row level security;
alter table products      enable row level security;
alter table product_daily enable row level security;
alter table store_daily   enable row level security;
alter table briefings     enable row level security;

create policy "own store" on stores
  for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy "own products" on products for select
  using (exists (select 1 from stores s where s.id = store_id and s.owner_user_id = auth.uid()));
create policy "own product_daily" on product_daily for select
  using (exists (select 1 from stores s where s.id = store_id and s.owner_user_id = auth.uid()));
create policy "own store_daily" on store_daily for select
  using (exists (select 1 from stores s where s.id = store_id and s.owner_user_id = auth.uid()));
create policy "own briefings" on briefings for select
  using (exists (select 1 from stores s where s.id = store_id and s.owner_user_id = auth.uid()));
