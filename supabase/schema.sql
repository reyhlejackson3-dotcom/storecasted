-- =====================================================================
-- Storecasted database
--
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run more than once: on a fresh project it creates everything;
-- on a project that ran an older version, it adds only what's missing.
--
-- Security model:
--   * Every table has row-level security on. A signed-in owner can only
--     ever read their own store's rows.
--   * Only the server (service-role key) writes synced Square data.
--   * Square tokens are encrypted by the app before they're stored here.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- stores: one per account ----------------------------------
create table if not exists stores (
  id                      uuid primary key default gen_random_uuid(),
  owner_user_id           uuid not null references auth.users(id) on delete cascade,
  store_name              text not null default 'My store',
  created_at              timestamptz not null default now()
);

alter table stores add column if not exists square_merchant_id      text;
alter table stores add column if not exists square_access_token     text;         -- ciphertext
alter table stores add column if not exists square_refresh_token    text;         -- ciphertext
alter table stores add column if not exists square_token_expires_at timestamptz;
alter table stores add column if not exists square_connected_at     timestamptz;
alter table stores add column if not exists square_needs_reconnect  boolean not null default false;
alter table stores add column if not exists last_synced_at          timestamptz;
alter table stores add column if not exists sync_error              text;
alter table stores add column if not exists timezone                text not null default 'America/Denver';
-- Billing (see src/lib/billing.ts).
-- 'unstarted' = signed up, never been through Stripe checkout — no card on
-- file, no trial running yet. The card is collected AT checkout, and the
-- 7-day trial itself lives in Stripe (subscription_data.trial_period_days),
-- so trial_ends_at below is filled in from Stripe's webhook, not by us.
-- 'free' = comped by you, set by hand.
alter table stores add column if not exists subscription_status     text not null default 'unstarted';
alter table stores add column if not exists trial_ends_at           timestamptz;
alter table stores add column if not exists stripe_customer_id      text;
alter table stores add column if not exists stripe_subscription_id  text;
alter table stores add column if not exists current_period_end      timestamptz;
alter table stores add column if not exists cancel_at               timestamptz;  -- cancelled, still active until this date
alter table stores alter column subscription_status set default 'unstarted';
alter table stores alter column trial_ends_at drop default;

-- The signup survey
alter table stores add column if not exists business_profile        jsonb;
alter table stores add column if not exists onboarded_at            timestamptz;

-- one Storecasted account per Square merchant, one store per login
create unique index if not exists stores_square_merchant_unique on stores (square_merchant_id);
create unique index if not exists stores_owner_unique on stores (owner_user_id);

-- ---------- products: one row per Square item variation --------------
create table if not exists products (
  store_id          uuid not null references stores(id) on delete cascade,
  square_item_id    text not null,
  name              text not null,
  category          text,
  price_cents       integer not null,
  unit_cost_cents   integer,             -- null = never entered in Square
  stock             integer,             -- null = item doesn't track inventory
  last_received_at  date,
  returns_90d       integer not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (store_id, square_item_id)
);
-- older versions had stock as NOT NULL DEFAULT 0, which would turn
-- "doesn't track inventory" into a false "out of stock"
alter table products alter column stock drop not null;
alter table products alter column stock drop default;

-- ---------- daily sales per item --------------------------------------
create table if not exists product_daily (
  store_id        uuid not null references stores(id) on delete cascade,
  square_item_id  text not null,
  day             date not null,
  units_sold      integer not null default 0,
  primary key (store_id, square_item_id, day)
);

-- ---------- daily totals per store ------------------------------------
create table if not exists store_daily (
  store_id       uuid not null references stores(id) on delete cascade,
  day            date not null,
  revenue_cents  integer not null default 0,
  order_count    integer not null default 0,
  primary key (store_id, day)
);

-- ---------- the saved morning briefings -------------------------------
create table if not exists briefings (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references stores(id) on delete cascade,
  day               date not null,
  items             jsonb not null,
  template_count    integer not null default 0,
  llm_count         integer not null default 0,
  llm_fallback_note text,
  generated_at      timestamptz not null default now(),
  unique (store_id, day)
);

create index if not exists product_daily_lookup on product_daily (store_id, day desc);
create index if not exists store_daily_lookup   on store_daily   (store_id, day desc);
create index if not exists briefings_lookup     on briefings     (store_id, day desc);

-- ---------- row-level security ----------------------------------------
alter table stores        enable row level security;
alter table products      enable row level security;
alter table product_daily enable row level security;
alter table store_daily   enable row level security;
alter table briefings     enable row level security;

drop policy if exists "own store"         on stores;
drop policy if exists "own products"      on products;
drop policy if exists "own product_daily" on product_daily;
drop policy if exists "own store_daily"   on store_daily;
drop policy if exists "own briefings"     on briefings;

-- owners can read, create and update their own store row...
create policy "own store" on stores
  for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- ...but only SOME columns. Row-level security decides WHICH rows; these
-- grants decide WHICH columns. Without them, an owner could set their own
-- subscription_status to 'active' from the browser and skip paying.
-- Billing and Square columns are written only by the server (service role).
revoke insert, update on stores from anon, authenticated;
grant insert (owner_user_id) on stores to authenticated;
grant update (store_name, business_profile, onboarded_at) on stores to authenticated;

-- owners can only READ their data; the server writes it
create policy "own products" on products for select
  using (exists (select 1 from stores s where s.id = store_id and s.owner_user_id = auth.uid()));
create policy "own product_daily" on product_daily for select
  using (exists (select 1 from stores s where s.id = store_id and s.owner_user_id = auth.uid()));
create policy "own store_daily" on store_daily for select
  using (exists (select 1 from stores s where s.id = store_id and s.owner_user_id = auth.uid()));
create policy "own briefings" on briefings for select
  using (exists (select 1 from stores s where s.id = store_id and s.owner_user_id = auth.uid()));
