-- =====================================================================
-- StyleNow — Migration 0003: payments, payouts, pricing, loyalty, reviews
-- =====================================================================

-- ---------------------------------------------------------------------
-- Payments (Stripe Connect, EU: cards + SEPA + wallets; PSD2/SCA aware)
-- ---------------------------------------------------------------------
CREATE TABLE payment (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           uuid NOT NULL REFERENCES booking(id) ON DELETE RESTRICT,
  shop_id              uuid NOT NULL REFERENCES shop(id),
  customer_id          uuid REFERENCES app_user(id),
  status               payment_status NOT NULL DEFAULT 'requires_action',
  method               payment_method NOT NULL,
  intent_kind          text NOT NULL DEFAULT 'full',   -- full|deposit|no_show_fee|late_fee|tip
  amount_cents         int  NOT NULL CHECK (amount_cents >= 0),
  platform_fee_cents   int  NOT NULL DEFAULT 0,
  vat_cents            int  NOT NULL DEFAULT 0,
  tip_cents            int  NOT NULL DEFAULT 0,
  currency             char(3) NOT NULL DEFAULT 'EUR',
  psp                  text NOT NULL DEFAULT 'stripe',
  psp_intent_id        text UNIQUE,
  psp_charge_id        text,
  psp_mandate_id       text,                            -- SEPA mandate reference
  sca_status           text,                            -- required|completed|exempted
  authorized_at        timestamptz,
  captured_at          timestamptz,
  failure_code         text,
  idempotency_key      text UNIQUE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_booking_idx ON payment (booking_id);
CREATE INDEX payment_shop_idx    ON payment (shop_id, created_at DESC);

CREATE TABLE refund (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     uuid NOT NULL REFERENCES payment(id) ON DELETE RESTRICT,
  amount_cents   int  NOT NULL CHECK (amount_cents > 0),
  reason         text NOT NULL,                          -- customer_cancel|shop_cancel|dispute|goodwill
  initiated_by   uuid REFERENCES app_user(id),
  psp_refund_id  text UNIQUE,
  status         text NOT NULL DEFAULT 'pending',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payout (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shop(id),
  period         daterange NOT NULL,
  gross_cents    int NOT NULL,
  fee_cents      int NOT NULL,
  refund_cents   int NOT NULL DEFAULT 0,
  net_cents      int NOT NULL,
  currency       char(3) NOT NULL DEFAULT 'EUR',
  status         payout_status NOT NULL DEFAULT 'scheduled',
  psp_payout_id  text,
  iban_last4     text,
  scheduled_for  date NOT NULL,
  paid_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payout_shop_idx ON payout (shop_id, scheduled_for DESC);

CREATE TABLE payout_item (
  payout_id   uuid NOT NULL REFERENCES payout(id) ON DELETE CASCADE,
  payment_id  uuid NOT NULL REFERENCES payment(id),
  amount_cents int NOT NULL,
  fee_cents   int NOT NULL,
  PRIMARY KEY (payout_id, payment_id)
);

CREATE TABLE invoice (                              -- §14 UStG compliant document metadata
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         text NOT NULL UNIQUE,              -- gapless sequence per issuer
  issuer         text NOT NULL,                     -- 'platform' | 'shop'
  shop_id        uuid REFERENCES shop(id),
  booking_id     uuid REFERENCES booking(id),
  payout_id      uuid REFERENCES payout(id),
  net_cents      int NOT NULL,
  vat_cents      int NOT NULL,
  gross_cents    int NOT NULL,
  vat_rate_bps   int NOT NULL,
  reverse_charge boolean NOT NULL DEFAULT false,
  pdf_media_id   uuid REFERENCES media_asset(id),
  issued_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gift_card (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash      bytea NOT NULL UNIQUE,
  shop_id        uuid REFERENCES shop(id),          -- NULL = platform-wide
  initial_cents  int NOT NULL,
  balance_cents  int NOT NULL,
  currency       char(3) NOT NULL DEFAULT 'EUR',
  purchased_by   uuid REFERENCES app_user(id),
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE voucher (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  shop_id         uuid REFERENCES shop(id),
  kind            text NOT NULL,                    -- percent|fixed|free_addon
  value           numeric(10,2) NOT NULL,
  min_spend_cents int NOT NULL DEFAULT 0,
  max_redemptions int,
  redemptions     int NOT NULL DEFAULT 0,
  per_user_limit  int NOT NULL DEFAULT 1,
  new_customers_only boolean NOT NULL DEFAULT false,
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  active          boolean NOT NULL DEFAULT true
);

CREATE TABLE voucher_redemption (
  voucher_id  uuid NOT NULL REFERENCES voucher(id) ON DELETE CASCADE,
  booking_id  uuid NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES app_user(id),
  amount_cents int NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (voucher_id, booking_id)
);

-- ---------------------------------------------------------------------
-- Dynamic pricing
-- ---------------------------------------------------------------------
CREATE TABLE pricing_rule (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  service_id     uuid REFERENCES service(id) ON DELETE CASCADE,  -- NULL = all services
  staff_id       uuid REFERENCES staff(id) ON DELETE CASCADE,
  kind           price_rule_kind NOT NULL,
  name           text NOT NULL,
  -- Matching conditions, all optional and ANDed together
  dows           smallint[],
  time_from      time,
  time_to        time,
  date_from      date,
  date_to        date,
  lead_hours_min int,
  lead_hours_max int,
  occupancy_min_pct numeric(5,2),
  occupancy_max_pct numeric(5,2),
  loyalty_tier   text,
  staff_tier     text,
  -- Effect
  adjust_kind    text NOT NULL DEFAULT 'percent',   -- percent|fixed_cents|set_cents
  adjust_value   numeric(10,2) NOT NULL,
  floor_cents    int,
  ceiling_cents  int,
  priority       int NOT NULL DEFAULT 100,
  stackable      boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_rule_bounds CHECK (ceiling_cents IS NULL OR floor_cents IS NULL OR ceiling_cents >= floor_cents)
);
CREATE INDEX pricing_rule_shop_idx ON pricing_rule (shop_id, priority) WHERE active;

CREATE TABLE price_quote (                          -- signed, short-lived, replayed at capture
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  payload_hash  bytea NOT NULL,
  quoted_cents  int NOT NULL,
  breakdown     jsonb NOT NULL,
  user_id       uuid REFERENCES app_user(id),
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_quote_expiry_idx ON price_quote (expires_at);

-- ---------------------------------------------------------------------
-- Loyalty & referrals
-- ---------------------------------------------------------------------
CREATE TABLE loyalty_program (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope               text NOT NULL DEFAULT 'platform',  -- platform|chain|shop
  chain_id            uuid REFERENCES chain(id) ON DELETE CASCADE,
  shop_id             uuid REFERENCES shop(id) ON DELETE CASCADE,
  name                text NOT NULL,
  points_per_euro     numeric(6,2) NOT NULL DEFAULT 1,
  cent_value_per_point numeric(6,4) NOT NULL DEFAULT 1.0,  -- 100 pts = 1.00 EUR
  tiers               jsonb NOT NULL DEFAULT '[]',         -- [{key:"silver",min_points:500,perks:[...]}]
  expiry_months       int NOT NULL DEFAULT 18,
  active              boolean NOT NULL DEFAULT true,
  CONSTRAINT loyalty_scope_target CHECK (
    (scope = 'platform' AND chain_id IS NULL AND shop_id IS NULL) OR
    (scope = 'chain'    AND chain_id IS NOT NULL) OR
    (scope = 'shop'     AND shop_id  IS NOT NULL))
);

CREATE TABLE loyalty_account (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id   uuid NOT NULL REFERENCES loyalty_program(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  points_balance int NOT NULL DEFAULT 0,
  lifetime_points int NOT NULL DEFAULT 0,
  tier         text NOT NULL DEFAULT 'base',
  tier_since   date,
  UNIQUE (program_id, user_id)
);

CREATE TABLE loyalty_ledger (                       -- append-only, points are money
  id           bigserial PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES loyalty_account(id) ON DELETE CASCADE,
  delta        int NOT NULL,
  reason       text NOT NULL,                       -- earn|redeem|expire|adjust|referral|review
  booking_id   uuid REFERENCES booking(id),
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyalty_ledger_account_idx ON loyalty_ledger (account_id, created_at DESC);

CREATE TABLE referral (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  code          text NOT NULL UNIQUE,
  referee_id    uuid REFERENCES app_user(id),
  qualified_booking_id uuid REFERENCES booking(id),
  reward_points int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  qualified_at  timestamptz
);

-- ---------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------
CREATE TABLE review (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid NOT NULL UNIQUE REFERENCES booking(id) ON DELETE CASCADE, -- verified only
  shop_id        uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  staff_id       uuid REFERENCES staff(id) ON DELETE SET NULL,
  author_id      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  rating         smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  rating_cleanliness smallint CHECK (rating_cleanliness BETWEEN 1 AND 5),
  rating_value   smallint CHECK (rating_value BETWEEN 1 AND 5),
  rating_punctuality smallint CHECK (rating_punctuality BETWEEN 1 AND 5),
  title          text,
  body           text,
  photo_media_ids uuid[] NOT NULL DEFAULT '{}',
  locale         text,
  status         text NOT NULL DEFAULT 'published',   -- published|held|removed
  moderation_score numeric(4,3),
  helpful_count  int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  edited_at      timestamptz
);
CREATE INDEX review_shop_idx ON review (shop_id, created_at DESC) WHERE status = 'published';

CREATE TABLE review_reply (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   uuid NOT NULL UNIQUE REFERENCES review(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES app_user(id),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE review_flag (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   uuid NOT NULL REFERENCES review(id) ON DELETE CASCADE,
  flagged_by  uuid REFERENCES app_user(id),
  reason      text NOT NULL,
  resolved_at timestamptz,
  resolution  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
