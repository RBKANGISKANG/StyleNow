-- =====================================================================
-- StyleNow — Migration 0002: schedules, availability, bookings, waitlist
-- =====================================================================

-- ---------------------------------------------------------------------
-- Staff working patterns & absences
-- ---------------------------------------------------------------------
CREATE TABLE staff_shift (                        -- recurring weekly pattern
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  dow          smallint NOT NULL CHECK (dow BETWEEN 0 AND 6),
  starts_at    time NOT NULL,
  ends_at      time NOT NULL,
  break_ranges jsonb NOT NULL DEFAULT '[]',       -- [{"from":"12:00","to":"12:45"}]
  valid_from   date NOT NULL DEFAULT CURRENT_DATE,
  valid_to     date,
  CONSTRAINT staff_shift_order CHECK (ends_at > starts_at)
);
CREATE INDEX staff_shift_staff_idx ON staff_shift (staff_id, dow);

CREATE TABLE staff_absence (                      -- holiday, sickness, training, one-off block
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  period     tstzrange NOT NULL,
  reason     text,
  approved_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  EXCLUDE USING gist (staff_id WITH =, period WITH &&)
);

CREATE TABLE staff_override (                     -- extra hours outside the weekly pattern
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  period     tstzrange NOT NULL,
  note       text
);

-- ---------------------------------------------------------------------
-- Cancellation policies (shop- or service-level)
-- ---------------------------------------------------------------------
CREATE TABLE cancellation_policy (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid REFERENCES shop(id) ON DELETE CASCADE, -- NULL = platform default
  name                  text NOT NULL,
  free_until_hours      int  NOT NULL DEFAULT 24,   -- free cancellation window
  late_fee_percent      numeric(5,2) NOT NULL DEFAULT 50,
  no_show_fee_percent   numeric(5,2) NOT NULL DEFAULT 100,
  reschedule_free_count int NOT NULL DEFAULT 1,
  reschedule_min_hours  int NOT NULL DEFAULT 12,
  grace_minutes         int NOT NULL DEFAULT 10,    -- late arrival before no-show
  text_de               text,
  text_en               text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE shop
  ADD CONSTRAINT shop_cancellation_policy_fk
  FOREIGN KEY (cancellation_policy_id) REFERENCES cancellation_policy(id);

ALTER TABLE service ADD COLUMN cancellation_policy_id uuid REFERENCES cancellation_policy(id);

-- ---------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------
CREATE TABLE booking (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference             text NOT NULL UNIQUE,       -- 'SN-7QK4-2M' shown to humans
  shop_id               uuid NOT NULL REFERENCES shop(id),
  customer_id           uuid REFERENCES app_user(id),          -- NULL for guest booking
  guest_name            text,
  guest_email           citext,
  guest_phone_e164      text,
  status                booking_status NOT NULL DEFAULT 'hold',
  period                tstzrange NOT NULL,                    -- customer-facing window
  occupancy             tstzrange NOT NULL,                    -- incl. buffers, used for conflicts
  locale                text NOT NULL DEFAULT 'de-DE',
  is_mobile             boolean NOT NULL DEFAULT false,
  service_address       jsonb,                                 -- mobile: where the stylist goes
  service_geo           geography(Point,4326),
  travel_fee_cents      int NOT NULL DEFAULT 0,
  subtotal_cents        int NOT NULL DEFAULT 0,
  discount_cents        int NOT NULL DEFAULT 0,
  loyalty_points_spent  int NOT NULL DEFAULT 0,
  vat_cents             int NOT NULL DEFAULT 0,
  total_cents           int NOT NULL DEFAULT 0,
  currency              char(3) NOT NULL DEFAULT 'EUR',
  deposit_cents         int NOT NULL DEFAULT 0,
  cancellation_policy_id uuid REFERENCES cancellation_policy(id),
  cancellation_fee_cents int NOT NULL DEFAULT 0,
  customer_note         text,
  internal_note         text,
  source                text NOT NULL DEFAULT 'web',           -- web|ios|android|walk_in|phone|widget
  match_score           numeric(5,4),                          -- AI ranking that produced the click
  hold_expires_at       timestamptz,
  confirmed_at          timestamptz,
  cancelled_at          timestamptz,
  cancelled_reason      text,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_customer_or_guest CHECK (customer_id IS NOT NULL OR guest_email IS NOT NULL OR guest_phone_e164 IS NOT NULL),
  CONSTRAINT booking_totals CHECK (total_cents >= 0)
);
CREATE INDEX booking_shop_period_idx  ON booking USING gist (shop_id, occupancy);
CREATE INDEX booking_customer_idx     ON booking (customer_id, lower(period) DESC);
CREATE INDEX booking_status_idx       ON booking (status, lower(period));
CREATE INDEX booking_hold_expiry_idx  ON booking (hold_expires_at) WHERE status = 'hold';

-- One row per service performed inside a booking (multi-service visits, multi-staff).
CREATE TABLE booking_item (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
  service_id        uuid NOT NULL REFERENCES service(id),
  variant_id        uuid REFERENCES service_variant(id),
  staff_id          uuid REFERENCES staff(id),
  resource_id       uuid REFERENCES resource(id),
  period            tstzrange NOT NULL,
  occupancy         tstzrange NOT NULL,
  service_name_snapshot text NOT NULL,             -- immutable receipt copy
  duration_min      int NOT NULL,
  unit_price_cents  int NOT NULL,
  price_cents       int NOT NULL,
  applied_rules     jsonb NOT NULL DEFAULT '[]',   -- dynamic-pricing audit trail
  addon_ids         uuid[] NOT NULL DEFAULT '{}',
  position          int NOT NULL DEFAULT 0
);
CREATE INDEX booking_item_booking_idx ON booking_item (booking_id);

-- Hard double-booking guard: a staff member cannot occupy two live slots at once.
-- Rows exist only while the occupancy is live — cancelling a booking DELETEs its
-- rows rather than flagging them, which is why there is no status column and no
-- partial predicate here. `booking_id` is denormalised alongside
-- `booking_item_id` so the cancel path can clear a whole booking in one
-- statement, and so a colour service can hold two rows (application + finish)
-- around its processing gap without either being the "primary" one.
CREATE TABLE staff_occupancy (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  booking_id  uuid REFERENCES booking(id) ON DELETE CASCADE,
  booking_item_id uuid REFERENCES booking_item(id) ON DELETE CASCADE,
  occupancy   tstzrange NOT NULL,
  kind        text NOT NULL DEFAULT 'booking',     -- booking|absence|travel|break|processing
  EXCLUDE USING gist (staff_id WITH =, occupancy WITH &&)
);
CREATE INDEX staff_occupancy_booking_idx ON staff_occupancy (booking_id);

CREATE TABLE resource_occupancy (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id     uuid NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
  booking_id      uuid REFERENCES booking(id) ON DELETE CASCADE,
  booking_item_id uuid REFERENCES booking_item(id) ON DELETE CASCADE,
  occupancy       tstzrange NOT NULL,
  EXCLUDE USING gist (resource_id WITH =, occupancy WITH &&)
);
CREATE INDEX resource_occupancy_booking_idx ON resource_occupancy (booking_id);

CREATE TABLE booking_event (                        -- append-only status/audit stream
  id           bigserial PRIMARY KEY,
  booking_id   uuid NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
  from_status  booking_status,
  to_status    booking_status NOT NULL,
  actor_user_id uuid REFERENCES app_user(id),
  actor_kind   text NOT NULL DEFAULT 'system',      -- customer|shop|admin|system
  reason       text,
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_event_booking_idx ON booking_event (booking_id, created_at);

-- ---------------------------------------------------------------------
-- Availability cache — derived, rebuilt by the slot projector
-- ---------------------------------------------------------------------
CREATE TABLE availability_day (
  shop_id        uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  staff_id       uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  day            date NOT NULL,
  free_ranges    jsonb NOT NULL,                    -- [["09:00","12:00"],["13:00","18:00"]] local
  free_minutes   int  NOT NULL DEFAULT 0,
  capacity_minutes int NOT NULL DEFAULT 0,
  occupancy_pct  numeric(5,2) GENERATED ALWAYS AS (
                   CASE WHEN capacity_minutes = 0 THEN 0
                        ELSE 100.0 * (capacity_minutes - free_minutes) / capacity_minutes END
                 ) STORED,
  rebuilt_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, day)
);
CREATE INDEX availability_day_shop_idx ON availability_day (shop_id, day);
CREATE INDEX availability_day_open_idx ON availability_day (day, shop_id) WHERE free_minutes > 0;

-- Short-lived seat reservation taken the moment a user opens checkout.
CREATE TABLE slot_hold (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  staff_id     uuid REFERENCES staff(id) ON DELETE CASCADE,
  occupancy    tstzrange NOT NULL,
  session_id   uuid NOT NULL,
  booking_id   uuid REFERENCES booking(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX slot_hold_expiry_idx ON slot_hold (expires_at);
CREATE INDEX slot_hold_lookup_idx ON slot_hold USING gist (staff_id, occupancy);

-- ---------------------------------------------------------------------
-- Waitlist — fills cancellations automatically
-- ---------------------------------------------------------------------
CREATE TABLE waitlist_entry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  service_id    uuid REFERENCES service(id) ON DELETE CASCADE,
  staff_id      uuid REFERENCES staff(id) ON DELETE SET NULL,
  earliest      timestamptz NOT NULL,
  latest        timestamptz NOT NULL,
  preferred_dows smallint[] NOT NULL DEFAULT '{}',
  max_price_cents int,
  notify_channels notification_channel[] NOT NULL DEFAULT '{push,email}',
  status        text NOT NULL DEFAULT 'active',     -- active|offered|converted|expired|cancelled
  offered_at    timestamptz,
  offer_expires_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX waitlist_active_idx ON waitlist_entry (shop_id, earliest) WHERE status = 'active';
