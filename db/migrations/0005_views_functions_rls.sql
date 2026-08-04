-- =====================================================================
-- StyleNow — Migration 0005: search view, triggers, slot function, RLS
-- =====================================================================

-- ---------------------------------------------------------------------
-- Search projection used by the discovery feed.
-- Service facts are pre-aggregated in a CTE so joining staff cannot fan the
-- rows out — otherwise a six-chair salon's service names appear six times in
-- the FTS document and ts_rank starts rewarding headcount.
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW shop_search AS
WITH svc AS (
  SELECT shop_id,
         MIN(base_price_cents)                                    AS price_from_cents,
         ARRAY_AGG(DISTINCT taxonomy_key)
           FILTER (WHERE taxonomy_key IS NOT NULL)                AS taxonomy_keys,
         string_agg(DISTINCT name, ' ')                           AS service_names
  FROM service
  WHERE active AND online_bookable
  GROUP BY shop_id
),
stf AS (
  SELECT shop_id, COUNT(*) AS bookable_staff
  FROM staff WHERE accepts_bookings GROUP BY shop_id
)
SELECT
  s.id                AS shop_id,
  s.slug,
  s.name,
  s.kind,
  s.is_mobile,
  s.city,
  s.country_code,
  s.geo,
  s.service_radius_m,
  s.rating_avg,
  s.rating_count,
  s.languages_spoken,
  s.amenities,
  s.logo_media_id,
  s.cover_media_id,
  svc.price_from_cents,
  svc.taxonomy_keys,
  COALESCE(stf.bookable_staff, 0) AS bookable_staff,
  to_tsvector('simple',
    coalesce(s.name,'')    || ' ' || coalesce(s.tagline,'') || ' ' ||
    coalesce(s.city,'')    || ' ' || coalesce(svc.service_names,'')) AS document
FROM shop s
LEFT JOIN svc ON svc.shop_id = s.id
LEFT JOIN stf ON stf.shop_id = s.id
WHERE s.status = 'approved';

CREATE UNIQUE INDEX shop_search_pk_idx  ON shop_search (shop_id);
CREATE INDEX shop_search_geo_idx        ON shop_search USING gist (geo);
CREATE INDEX shop_search_doc_idx        ON shop_search USING gin (document);
CREATE INDEX shop_search_tax_idx        ON shop_search USING gin (taxonomy_keys);

-- ---------------------------------------------------------------------
-- Rating rollups
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_shop_rating() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN target := OLD.shop_id; ELSE target := NEW.shop_id; END IF;
  UPDATE shop s SET
    rating_avg   = COALESCE(r.avg_rating, 0),
    rating_count = COALESCE(r.n, 0),
    updated_at   = now()
  FROM (
    SELECT ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS n
    FROM review WHERE shop_id = target AND status = 'published'
  ) r
  WHERE s.id = target;
  RETURN NULL;
END $$;

CREATE TRIGGER review_rating_rollup
AFTER INSERT OR DELETE OR UPDATE OF rating, status ON review
FOR EACH ROW EXECUTE FUNCTION refresh_shop_rating();

-- ---------------------------------------------------------------------
-- Keep booking totals in sync with items.
-- VAT is recomputed from each item's own rate — a shop may mix the 19 % standard
-- rate with a 7 % reduced one, and a hardcoded divisor would mis-post the
-- §14 UStG invoice.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalc_booking_totals() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE b uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN b := OLD.booking_id; ELSE b := NEW.booking_id; END IF;
  UPDATE booking bk SET
    subtotal_cents = COALESCE(i.sum_cents, 0),
    vat_cents      = COALESCE(i.sum_vat, 0),
    total_cents    = GREATEST(COALESCE(i.sum_cents,0) + bk.travel_fee_cents - bk.discount_cents, 0),
    updated_at     = now()
  FROM (
    SELECT SUM(bi.price_cents) AS sum_cents,
           SUM(ROUND(bi.price_cents::numeric * sv.vat_rate_bps
                     / (10000 + sv.vat_rate_bps)))::int AS sum_vat
    FROM booking_item bi
    JOIN service sv ON sv.id = bi.service_id
    WHERE bi.booking_id = b
  ) i
  WHERE bk.id = b;
  RETURN NULL;
END $$;

CREATE TRIGGER booking_item_totals
AFTER INSERT OR DELETE OR UPDATE OF price_cents ON booking_item
FOR EACH ROW EXECUTE FUNCTION recalc_booking_totals();

-- ---------------------------------------------------------------------
-- Slot generation — the read path behind "show me free times".
--
-- This is the cold path and the reference implementation. It must agree
-- slot-for-slot with slotsForStaff() in apps/api/src/domain/availability.ts, so
-- both anchor the candidate grid to the shop-local start of the working window
-- and both reserve buffer_after_min inside the window. All seven conditions from
-- the spec are checked here: shop open, staff rostered, not absent, not busy,
-- resources free, not held in someone else's checkout, and within the shop's
-- lead time and booking horizon.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION find_free_slots(
  p_shop_id     uuid,
  p_service_id  uuid,
  p_day         date,
  p_staff_id    uuid DEFAULT NULL,
  p_tz          text DEFAULT 'Europe/Berlin'
) RETURNS TABLE (staff_id uuid, slot_start timestamptz, slot_end timestamptz)
LANGUAGE sql STABLE AS $$
WITH svc AS (
  SELECT s.id,
         s.duration_min + s.processing_gap_min + s.finish_min AS total_min,
         sh.slot_granularity_min,
         sh.buffer_before_min,
         sh.buffer_after_min,
         sh.booking_lead_min,
         sh.booking_horizon_days
  FROM service s
  JOIN shop sh ON sh.id = s.shop_id
  WHERE s.id = p_service_id AND s.shop_id = p_shop_id AND s.active AND s.online_bookable
    AND p_day <= (CURRENT_DATE + sh.booking_horizon_days)
),
-- Condition 1: the shop is open. No opening hours for this weekday → no slots.
open_hours AS (
  SELECT tstzrange((p_day + h.opens_at)  AT TIME ZONE p_tz,
                   (p_day + h.closes_at) AT TIME ZONE p_tz, '[)') AS open_window
  FROM shop_hours h
  WHERE h.shop_id = p_shop_id
    AND h.dow = EXTRACT(DOW FROM p_day)::smallint
    AND (h.valid_from IS NULL OR h.valid_from <= p_day)
    AND (h.valid_to   IS NULL OR h.valid_to   >= p_day)
),
eligible_staff AS (
  SELECT st.id
  FROM staff st
  JOIN staff_service ss ON ss.staff_id = st.id AND ss.service_id = p_service_id
  WHERE st.shop_id = p_shop_id
    AND st.accepts_bookings
    AND (p_staff_id IS NULL OR st.id = p_staff_id)
),
-- Condition 2: the stylist is rostered, and their shift is clipped to the
-- shop's opening hours so an over-generous roster cannot sell a closed shop.
working AS (
  SELECT es.id AS staff_id,
         tstzrange(
           GREATEST((p_day + sh.starts_at) AT TIME ZONE p_tz, lower(oh.open_window)),
           LEAST(   (p_day + sh.ends_at)   AT TIME ZONE p_tz, upper(oh.open_window)),
           '[)') AS work_window,
         sh.break_ranges
  FROM eligible_staff es
  JOIN staff_shift sh ON sh.staff_id = es.id
  CROSS JOIN open_hours oh
  WHERE sh.dow = EXTRACT(DOW FROM p_day)::smallint
    AND sh.valid_from <= p_day
    AND (sh.valid_to IS NULL OR sh.valid_to >= p_day)
    AND (p_day + sh.starts_at) AT TIME ZONE p_tz < upper(oh.open_window)
    AND (p_day + sh.ends_at)   AT TIME ZONE p_tz > lower(oh.open_window)
),
-- Condition 3: rostered breaks are not bookable.
breaks AS (
  SELECT w.staff_id,
         tstzrange((p_day + (br->>'from')::time) AT TIME ZONE p_tz,
                   (p_day + (br->>'to')::time)   AT TIME ZONE p_tz, '[)') AS period
  FROM working w
  CROSS JOIN LATERAL jsonb_array_elements(w.break_ranges) AS br
),
candidates AS (
  SELECT w.staff_id,
         gs AS slot_start,
         gs + make_interval(mins => svc.total_min) AS slot_end,
         tstzrange(gs - make_interval(mins => svc.buffer_before_min),
                   gs + make_interval(mins => svc.total_min + svc.buffer_after_min), '[)') AS occ
  FROM working w
  CROSS JOIN svc
  CROSS JOIN LATERAL generate_series(
        lower(w.work_window) + make_interval(mins => svc.buffer_before_min),
        upper(w.work_window) - make_interval(mins => svc.total_min + svc.buffer_after_min),
        make_interval(mins => svc.slot_granularity_min)) AS gs
  WHERE gs >= now() + make_interval(mins => svc.booking_lead_min)
)
SELECT c.staff_id, c.slot_start, c.slot_end
FROM candidates c
-- Condition 4: not already booked (or travelling, or on an ad-hoc block).
WHERE NOT EXISTS (
        SELECT 1 FROM staff_occupancy so
        WHERE so.staff_id = c.staff_id AND so.occupancy && c.occ)
-- Condition 5: not on approved leave.
  AND NOT EXISTS (
        SELECT 1 FROM staff_absence sa
        WHERE sa.staff_id = c.staff_id AND sa.period && c.occ)
  AND NOT EXISTS (
        SELECT 1 FROM breaks br
        WHERE br.staff_id = c.staff_id AND br.period && c.occ)
-- Condition 6: every resource the service needs has spare capacity.
  AND NOT EXISTS (
        SELECT 1
        FROM service_resource_req req
        WHERE req.service_id = p_service_id
          AND req.quantity > (
            SELECT COUNT(*)
            FROM resource r
            WHERE r.shop_id = p_shop_id AND r.kind = req.resource_kind AND r.active
              AND NOT EXISTS (
                SELECT 1 FROM resource_occupancy ro
                WHERE ro.resource_id = r.id AND ro.occupancy && c.occ)))
-- Condition 7: nobody else is holding this seat in checkout right now.
  AND NOT EXISTS (
        SELECT 1 FROM slot_hold sh2
        WHERE sh2.staff_id = c.staff_id AND sh2.occupancy && c.occ
          AND sh2.expires_at > now())
  AND NOT EXISTS (
        SELECT 1 FROM shop_closure sc
        WHERE sc.shop_id = p_shop_id AND sc.period && c.occ)
ORDER BY c.slot_start, c.staff_id;
$$;

-- ---------------------------------------------------------------------
-- Application role. RLS is bypassed by table owners and superusers, so the API
-- must NOT connect as the migration user — hence a dedicated role plus
-- FORCE ROW LEVEL SECURITY on every policy-bearing table.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_api;

-- ---------------------------------------------------------------------
-- Row-level security — tenant isolation enforced by the database.
-- The API sets, per request:
--   SET LOCAL app.user_id  = '<uuid>';
--   SET LOCAL app.shop_ids = '<uuid>,<uuid>';
--   SET LOCAL app.role     = 'customer' | 'shop_owner' | 'platform_admin' | …
--
-- Helper functions keep the policies readable and make the "unset variable"
-- case explicit: an anonymous request has no user id and no shop ids, and must
-- still be able to read a published shop's public catalogue.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_shop_ids() RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    string_to_array(NULLIF(current_setting('app.shop_ids', true), ''), ',')::uuid[],
    '{}'::uuid[])
$$;

CREATE OR REPLACE FUNCTION app_is_staff_of(p_shop_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_shop_id = ANY (app_shop_ids())
$$;

CREATE OR REPLACE FUNCTION app_is_platform() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.role', true), '') IN ('platform_admin','support')
$$;

ALTER TABLE booking          ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_item     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment          ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff            ENABLE ROW LEVEL SECURITY;
ALTER TABLE service          ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking          FORCE ROW LEVEL SECURITY;
ALTER TABLE booking_item     FORCE ROW LEVEL SECURITY;
ALTER TABLE payment          FORCE ROW LEVEL SECURITY;
ALTER TABLE staff            FORCE ROW LEVEL SECURITY;
ALTER TABLE service          FORCE ROW LEVEL SECURITY;

-- booking: platform, the owning shop, or the customer on the booking.
CREATE POLICY booking_access ON booking
  USING (app_is_platform()
         OR app_is_staff_of(shop_id)
         OR (customer_id IS NOT NULL AND customer_id = app_user_id()))
  WITH CHECK (app_is_platform()
         OR app_is_staff_of(shop_id)
         OR (customer_id IS NOT NULL AND customer_id = app_user_id()));

-- booking_item: inherits its parent booking's visibility. Without this policy
-- the table is readable by nobody and writable by nobody, which takes the whole
-- checkout down — RLS enabled with zero policies denies everything.
CREATE POLICY booking_item_access ON booking_item
  USING (EXISTS (SELECT 1 FROM booking b WHERE b.id = booking_item.booking_id))
  WITH CHECK (EXISTS (SELECT 1 FROM booking b WHERE b.id = booking_item.booking_id));

CREATE POLICY payment_access ON payment
  USING (app_is_platform()
         OR app_is_staff_of(shop_id)
         OR (customer_id IS NOT NULL AND customer_id = app_user_id()))
  WITH CHECK (app_is_platform() OR app_is_staff_of(shop_id));

-- staff: the shop manages its own; anyone may read the team of a published shop
-- (the landing page and the stylist profile both need this).
CREATE POLICY staff_manage ON staff
  USING (app_is_platform() OR app_is_staff_of(shop_id))
  WITH CHECK (app_is_platform() OR app_is_staff_of(shop_id));

CREATE POLICY staff_public_read ON staff FOR SELECT
  USING (EXISTS (SELECT 1 FROM shop s WHERE s.id = staff.shop_id AND s.status = 'approved'));

-- service: the shop writes its own catalogue; the world reads the active part of
-- a published one. A SELECT-only policy here would make every catalogue UPDATE
-- silently affect zero rows.
CREATE POLICY service_manage ON service
  USING (app_is_platform() OR app_is_staff_of(shop_id))
  WITH CHECK (app_is_platform() OR app_is_staff_of(shop_id));

CREATE POLICY service_public_read ON service FOR SELECT
  USING (active AND EXISTS (
           SELECT 1 FROM shop s WHERE s.id = service.shop_id AND s.status = 'approved'));

-- ---------------------------------------------------------------------
-- Seed: platform defaults
-- ---------------------------------------------------------------------
INSERT INTO cancellation_policy (shop_id, name, free_until_hours, late_fee_percent, no_show_fee_percent, text_de, text_en)
VALUES (NULL, 'StyleNow Standard', 24, 50, 100,
        'Kostenlose Stornierung bis 24 Stunden vor dem Termin.',
        'Free cancellation up to 24 hours before your appointment.');

INSERT INTO retention_policy (entity_kind, retain_days, legal_basis, action) VALUES
  ('trip_ping',        30,   'Art. 5(1)(e) GDPR — storage limitation', 'delete'),
  ('auth_session',     90,   'security logging',                       'delete'),
  ('notification_log', 365,  'delivery dispute evidence',              'anonymise'),
  ('booking',          1095, 'contract performance + warranty',        'anonymise'),
  ('invoice',          3650, '§147 AO — 10 year retention',            'archive'),
  ('match_event',      180,  'model training, legitimate interest',    'anonymise');
