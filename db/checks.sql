-- Integrity checks for the Supabase/Postgres database. Each query returns one
-- row: the check's name and how many rows violate it (0 = healthy).
-- Run directly with: psql "$DATABASE_URL" -At -F $'\t' -f db/checks.sql
-- or through scripts/db-check.ts (npm run db:check) with DATABASE_URL set.

select 'bookings with an unknown status', count(*) from public.bookings
  where status not in ('hold','pending_payment','confirmed','completed','no_show','cancelled_by_customer','cancelled_by_shop');

select 'holds without an expiry', count(*) from public.bookings
  where status = 'hold' and hold_expires_at is null;

select 'expired holds still occupying a chair', count(*) from public.bookings b
  where b.status = 'hold' and b.hold_expires_at < now() - interval '1 hour'
    and exists (select 1 from public.staff_occupancy o where o.booking_id = b.id);

select 'cancelled bookings still occupying a chair', count(*) from public.bookings b
  where b.status in ('cancelled_by_customer','cancelled_by_shop','no_show')
    and exists (select 1 from public.staff_occupancy o where o.booking_id = b.id);

select 'live bookings with no chair time', count(*) from public.bookings b
  where b.status in ('pending_payment','confirmed')
    and not exists (select 1 from public.staff_occupancy o where o.booking_id = b.id);

select 'paid more than the total', count(*) from public.bookings
  where coalesce((data->>'paidCents')::bigint, 0) > coalesce((data->'quote'->>'totalCents')::bigint, 0);

select 'negative money amounts', count(*) from public.bookings
  where coalesce((data->>'paidCents')::bigint, 0) < 0
     or coalesce((data->>'refundedCents')::bigint, 0) < 0
     or coalesce((data->'quote'->>'totalCents')::bigint, 0) < 0;

select 'deposit above the total', count(*) from public.bookings
  where coalesce((data->'quote'->>'depositCents')::bigint, 0) > coalesce((data->'quote'->>'totalCents')::bigint, 0);

select 'typed columns disagree with the stored document', count(*) from public.bookings
  where data->>'status' is distinct from status
     or data->>'shopId' is distinct from shop_id
     or data->>'deviceId' is distinct from device_id;

select 'occupancy rows pointing at a missing booking', count(*) from public.staff_occupancy o
  where not exists (select 1 from public.bookings b where b.id = o.booking_id);

select 'server state missing (server mode never saved)', count(*) from (select 1) x
  where to_regclass('public.stylenow_records') is not null
    and not exists (select 1 from public.stylenow_records);

select 'server records with an empty document', count(*) from public.stylenow_records
  where to_regclass('public.stylenow_records') is not null and doc = 'null'::jsonb;

select 'no backup in the last 2 days', count(*) from (select 1) x
  where to_regclass('public.stylenow_backups') is not null
    and exists (select 1 from public.stylenow_records)
    and not exists (select 1 from public.stylenow_backups where taken_at > now() - interval '2 days');
