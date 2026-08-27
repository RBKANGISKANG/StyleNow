-- ===========================================================================
-- StyleNow — Supabase backing store for the web app
--
-- Run this once in the Supabase SQL editor (or `supabase db push`), then set
--   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
-- in apps/web (.env.local or your host's env) and rebuild.
--
-- Scope: this is the *product-demo* persistence layer — bookings, seat
-- occupancy, and the dashboard's config toggles. The full marketplace schema
-- (payments, loyalty, GDPR retention, RLS-per-tenant, …) lives in
-- db/migrations/ and remains the reference for the production API.
--
-- The one invariant this file must carry is the same one the full schema
-- carries: A SLOT CANNOT BE SOLD TWICE. That is the GiST EXCLUDE constraint
-- on staff_occupancy below — the database refuses the second overlapping
-- seat, no matter how many browsers race.
-- ===========================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- bookings: typed columns for querying + the full booking document as jsonb
-- (quote, breakdown, policy snapshot — shapes defined in apps/web/src/core).
-- ---------------------------------------------------------------------------
create table if not exists public.bookings (
  id              text primary key,
  shop_id         text        not null,
  staff_id        text        not null,
  device_id       text        not null,
  starts_at       timestamptz not null,
  status          text        not null,
  hold_expires_at timestamptz,
  data            jsonb       not null,
  created_at      timestamptz not null default now()
);

create index if not exists bookings_shop_day  on public.bookings (shop_id, starts_at);
create index if not exists bookings_device    on public.bookings (device_id, starts_at desc);

-- ---------------------------------------------------------------------------
-- staff_occupancy: one row per blocked window (a colour service writes two —
-- application and finishing — leaving the processing gap free, exactly like
-- db/migrations/0002). The EXCLUDE constraint is the double-booking guarantee.
-- ---------------------------------------------------------------------------
create table if not exists public.staff_occupancy (
  id         bigint generated always as identity primary key,
  booking_id text not null references public.bookings (id) on delete cascade,
  staff_id   text not null,
  during     tstzrange not null,
  constraint staff_no_overlap exclude using gist (staff_id with =, during with &&)
);

create index if not exists occupancy_booking on public.staff_occupancy (booking_id);

-- ---------------------------------------------------------------------------
-- dashboard config
-- ---------------------------------------------------------------------------
create table if not exists public.rule_state (
  rule_id text primary key,
  enabled boolean not null default true
);

create table if not exists public.service_overrides (
  service_id text primary key,
  patch      jsonb not null
);

-- Shop logos, stored as compact data URLs (client-side resized to ≤256 px).
create table if not exists public.shop_logos (
  shop_id  text primary key,
  data_url text not null
);

-- Company-suggested categories: once one partner adds a missing category it
-- becomes selectable for every later registration.
create table if not exists public.custom_categories (
  id    text primary key,
  label text not null
);

-- ---------------------------------------------------------------------------
-- create_hold: seat + booking in one transaction.
--   * first releases seats of expired holds (they no longer block);
--   * inserts the booking and its occupancy ranges;
--   * an exclusion violation (SQLSTATE 23P01) is caught and returned as
--     {"conflict": true} so the client can answer with alternatives.
-- ---------------------------------------------------------------------------
create or replace function public.create_hold(p_booking jsonb, p_ranges jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  -- lazily release seats whose hold expired
  delete from staff_occupancy so
  using bookings b
  where so.booking_id = b.id
    and b.status in ('hold', 'pending_payment')
    and b.hold_expires_at is not null
    and b.hold_expires_at < now();

  insert into bookings (id, shop_id, staff_id, device_id, starts_at, status, hold_expires_at, data)
  values (
    p_booking->>'id',
    p_booking->>'shop_id',
    p_booking->>'staff_id',
    p_booking->>'device_id',
    (p_booking->>'starts_at')::timestamptz,
    p_booking->>'status',
    (p_booking->>'hold_expires_at')::timestamptz,
    p_booking->'data'
  );

  begin
    for r in select * from jsonb_array_elements(p_ranges) loop
      insert into staff_occupancy (booking_id, staff_id, during)
      values (
        p_booking->>'id',
        p_booking->>'staff_id',
        tstzrange((r->>'start')::timestamptz, (r->>'end')::timestamptz, '[)')
      );
    end loop;
  exception
    when exclusion_violation then
      -- the savepoint pattern from the scaffold: roll the seat back, keep the
      -- function alive, tell the caller the slot is gone
      delete from bookings where id = p_booking->>'id';
      return jsonb_build_object('conflict', true);
  end;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_booking: status transitions (confirm / cancel / complete / no-show).
-- p_release_seat frees the stylist's calendar — cancellations must, so the
-- waitlist can move in; completions must not.
-- ---------------------------------------------------------------------------
create or replace function public.set_booking(p_id text, p_data jsonb, p_release_seat boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update bookings
  set status          = p_data->>'status',
      hold_expires_at = nullif(p_data->>'holdExpiresAt', '')::timestamptz,
      data            = p_data
  where id = p_id;

  if p_release_seat then
    delete from staff_occupancy where booking_id = p_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- reschedule_booking: move a booking's seat atomically. The delete + inserts
-- run in one exception block (a subtransaction): a conflicting target window
-- rolls the whole block back, so the original seat is never lost.
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_booking(p_id text, p_data jsonb, p_ranges jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  begin
    delete from staff_occupancy where booking_id = p_id;
    for r in select * from jsonb_array_elements(p_ranges) loop
      insert into staff_occupancy (booking_id, staff_id, during)
      values (
        p_id,
        p_data->>'staffId',
        tstzrange((r->>'start')::timestamptz, (r->>'end')::timestamptz, '[)')
      );
    end loop;
  exception
    when exclusion_violation then
      return jsonb_build_object('conflict', true);
  end;

  update bookings
  set staff_id  = p_data->>'staffId',
      starts_at = to_timestamp((p_data->>'startsAt')::bigint / 1000.0),
      data      = p_data
  where id = p_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security. Demo posture: the anon key may read bookings and config
-- and write config; all booking writes go through the definer RPCs above.
-- Production tightens this to per-tenant policies (see db/migrations/0005).
-- ---------------------------------------------------------------------------
alter table public.bookings          enable row level security;
alter table public.staff_occupancy   enable row level security;
alter table public.rule_state        enable row level security;
alter table public.service_overrides enable row level security;
alter table public.shop_logos        enable row level security;
alter table public.custom_categories enable row level security;

drop policy if exists bookings_read      on public.bookings;
drop policy if exists occupancy_read     on public.staff_occupancy;
drop policy if exists rule_state_rw      on public.rule_state;
drop policy if exists service_over_rw    on public.service_overrides;

create policy bookings_read   on public.bookings          for select using (true);
create policy occupancy_read  on public.staff_occupancy   for select using (true);
create policy rule_state_rw   on public.rule_state        for all    using (true) with check (true);
create policy service_over_rw on public.service_overrides for all    using (true) with check (true);
drop policy if exists shop_logos_rw on public.shop_logos;
create policy shop_logos_rw  on public.shop_logos         for all    using (true) with check (true);
drop policy if exists custom_cats_rw on public.custom_categories;
create policy custom_cats_rw on public.custom_categories   for all    using (true) with check (true);

grant execute on function public.create_hold(jsonb, jsonb) to anon, authenticated;
grant execute on function public.set_booking(text, jsonb, boolean) to anon, authenticated;
grant execute on function public.reschedule_booking(text, jsonb, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- accounts & partner onboarding
-- ---------------------------------------------------------------------------

-- Customer profile document, one row per auth user. RLS: strictly own-row.
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Shop / company registration applications. The browser may only INSERT —
-- reading the queue is the admin's job (service-role key / dashboard),
-- mirroring GET /admin/shops/pending in the API contract.
create table if not exists public.shop_applications (
  id         text primary key,
  data       jsonb not null,
  status     text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.shop_applications enable row level security;
drop policy if exists applications_insert on public.shop_applications;
create policy applications_insert on public.shop_applications
  for insert with check (true);

-- Social login (Google / Apple / Facebook) is configured per provider in
-- Supabase → Authentication → Providers; the app calls signInWithOAuth and
-- shows a hint when a provider is not enabled yet.

-- ---------------------------------------------------------------------------
-- Shop configuration, as one document per shop.
--
-- Bookings are transactional and keep the relational model above, guarded by
-- the EXCLUDE constraint on staff_occupancy. Everything a shop *configures* —
-- its team and their rosters, branches, absences, closing days, own services
-- and pricing rules, and the private notes it keeps about customers — is a
-- document only that shop's operator edits, so it syncs as JSON.
--
-- Without this table the back office is per-browser: a salon that adds a
-- stylist on the desktop still sees the old team on the tablet.
-- ---------------------------------------------------------------------------
create table if not exists public.shop_state (
  shop_id    text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.shop_state enable row level security;
drop policy if exists shop_state_rw on public.shop_state;
create policy shop_state_rw on public.shop_state for all using (true) with check (true);

-- Booking columns added after the first cut. Idempotent: safe to re-run.
--   guest_phone / guest_note  captured at checkout, shown to the shop
--   refunded_cents            money actually returned on a cancellation
--   review_reply              the shop's public answer to a review
-- They live inside bookings.data as well; these columns make them queryable.
alter table public.bookings add column if not exists guest_phone   text;
alter table public.bookings add column if not exists guest_note    text;
alter table public.bookings add column if not exists refunded_cents integer not null default 0;
alter table public.bookings add column if not exists review_reply  jsonb;

-- The waiting list: who asked to be told when a day frees up.
create table if not exists public.waitlist (
  id          text primary key,
  shop_id     text not null,
  device_id   text not null,
  service_ids text[] not null,
  iso_date    date not null,
  created_at  timestamptz not null default now()
);
create index if not exists waitlist_shop_day on public.waitlist (shop_id, iso_date);

alter table public.waitlist enable row level security;
drop policy if exists waitlist_rw on public.waitlist;
create policy waitlist_rw on public.waitlist for all using (true) with check (true);
