-- =====================================================================
-- StyleNow — Core schema (PostgreSQL 16)
-- Migration 0001: extensions, enums, identity, tenancy, catalog
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "postgis";       -- geography(Point) for GPS
CREATE EXTENSION IF NOT EXISTS "btree_gist";    -- EXCLUDE on (uuid, tstzrange)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- fuzzy shop/service search
CREATE EXTENSION IF NOT EXISTS "vector";        -- pgvector, AI smart matching
CREATE EXTENSION IF NOT EXISTS "citext";        -- case-insensitive email

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
CREATE TYPE user_role          AS ENUM ('customer','staff','shop_owner','chain_admin','platform_admin','support');
CREATE TYPE shop_kind          AS ENUM ('hair_salon','nail_studio','barbershop','brow_lash','spa','mobile_stylist','multi');
CREATE TYPE shop_status        AS ENUM ('draft','pending_review','changes_requested','approved','suspended','archived');
CREATE TYPE booking_status     AS ENUM ('hold','pending_payment','confirmed','checked_in','in_progress','completed','cancelled_by_customer','cancelled_by_shop','no_show','expired');
CREATE TYPE payment_status     AS ENUM ('requires_action','authorized','captured','partially_refunded','refunded','failed','cancelled');
CREATE TYPE payment_method     AS ENUM ('card','sepa_debit','paypal','apple_pay','google_pay','klarna','cash_on_site','gift_card');
CREATE TYPE payout_status      AS ENUM ('scheduled','in_transit','paid','failed','reversed');
CREATE TYPE dispute_status     AS ENUM ('open','awaiting_shop','awaiting_customer','under_review','resolved','escalated','closed');
CREATE TYPE notification_kind  AS ENUM ('booking_confirmed','booking_reminder','booking_changed','booking_cancelled','stylist_en_route','review_request','payment_receipt','payout_notice','marketing','waitlist_offer','shop_moderation');
CREATE TYPE notification_channel AS ENUM ('push','email','sms','whatsapp','in_app');
CREATE TYPE consent_purpose    AS ENUM ('essential','analytics','marketing_email','marketing_sms','marketing_whatsapp','personalisation','location_tracking');
CREATE TYPE dsr_kind           AS ENUM ('access','rectification','erasure','restriction','portability','objection');
CREATE TYPE dsr_status         AS ENUM ('received','identity_pending','in_progress','fulfilled','partially_fulfilled','refused','withdrawn');
CREATE TYPE trip_status        AS ENUM ('scheduled','preparing','en_route','arrived','servicing','completed','aborted');
CREATE TYPE price_rule_kind    AS ENUM ('time_of_day','day_of_week','lead_time','occupancy','seasonal','new_customer','loyalty_tier','last_minute','staff_tier');

-- ---------------------------------------------------------------------
-- Identity & access
-- ---------------------------------------------------------------------
CREATE TABLE app_user (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext UNIQUE,
  phone_e164         text UNIQUE,
  email_verified_at  timestamptz,
  phone_verified_at  timestamptz,
  password_hash      text,                       -- argon2id; NULL for social-only
  display_name       text NOT NULL,
  avatar_media_id    uuid,
  locale             text NOT NULL DEFAULT 'de-DE',
  timezone           text NOT NULL DEFAULT 'Europe/Berlin',
  marketing_opt_in   boolean NOT NULL DEFAULT false,
  mfa_secret         bytea,
  last_seen_at       timestamptz,
  deleted_at         timestamptz,                -- soft delete; GDPR job hard-purges
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_contact_present CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);
CREATE INDEX app_user_active_idx ON app_user (created_at) WHERE deleted_at IS NULL;

CREATE TABLE user_identity (                     -- OAuth / OIDC links
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider      text NOT NULL,                   -- 'apple','google','facebook'
  provider_uid  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE role_grant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role        user_role NOT NULL,
  chain_id    uuid,                              -- scope: chain-wide
  shop_id     uuid,                              -- scope: single shop
  granted_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE UNIQUE INDEX role_grant_unique_idx
  ON role_grant (user_id, role, COALESCE(chain_id,'00000000-0000-0000-0000-000000000000'::uuid),
                 COALESCE(shop_id,'00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;

CREATE TABLE auth_session (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  refresh_hash   bytea NOT NULL,
  device_label   text,
  ip_hash        bytea,                          -- salted hash, never raw IP at rest
  user_agent     text,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_session_user_idx ON auth_session (user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- Media (S3-compatible object store; rows are metadata only)
-- ---------------------------------------------------------------------
CREATE TABLE media_asset (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind    text NOT NULL,                   -- 'shop','user','service','review','staff'
  owner_id      uuid NOT NULL,
  storage_key   text NOT NULL UNIQUE,
  mime_type     text NOT NULL,
  bytes         bigint NOT NULL,
  width         int,
  height        int,
  blurhash      text,
  alt_text      text,
  variants      jsonb NOT NULL DEFAULT '{}',     -- {thumb:key, md:key, avif:key}
  moderation    text NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_owner_idx ON media_asset (owner_kind, owner_id);

-- ---------------------------------------------------------------------
-- Chains & shops
-- ---------------------------------------------------------------------
CREATE TABLE chain (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  slug           text NOT NULL UNIQUE,
  logo_media_id  uuid REFERENCES media_asset(id),
  legal_name     text,
  vat_id         text,
  billing_email  citext,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id              uuid REFERENCES chain(id) ON DELETE SET NULL,
  owner_user_id         uuid NOT NULL REFERENCES app_user(id),
  slug                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  kind                  shop_kind NOT NULL,
  status                shop_status NOT NULL DEFAULT 'draft',
  is_mobile             boolean NOT NULL DEFAULT false,
  tagline               text,
  description           text,
  logo_media_id         uuid REFERENCES media_asset(id),
  cover_media_id        uuid REFERENCES media_asset(id),
  brand                 jsonb NOT NULL DEFAULT '{}',  -- {primary:'#111', accent:'#e0b', font:'Inter'}
  -- physical address (NULL-able for pure mobile shops)
  address_line1         text,
  address_line2         text,
  postal_code           text,
  city                  text,
  country_code          char(2) NOT NULL DEFAULT 'DE',
  geo                   geography(Point,4326),
  service_radius_m      int,                          -- mobile shops: travel radius
  timezone              text NOT NULL DEFAULT 'Europe/Berlin',
  currency              char(3) NOT NULL DEFAULT 'EUR',
  phone_e164            text,
  public_email          citext,
  website_url           text,
  socials               jsonb NOT NULL DEFAULT '{}',
  amenities             text[] NOT NULL DEFAULT '{}', -- wifi, parking, wheelchair, kids
  languages_spoken      text[] NOT NULL DEFAULT '{de,en}',
  booking_lead_min      int  NOT NULL DEFAULT 60,     -- min minutes before start
  booking_horizon_days  int  NOT NULL DEFAULT 90,
  slot_granularity_min  int  NOT NULL DEFAULT 15,
  buffer_before_min     int  NOT NULL DEFAULT 0,
  buffer_after_min      int  NOT NULL DEFAULT 10,
  auto_confirm          boolean NOT NULL DEFAULT true,
  deposit_percent       numeric(5,2) NOT NULL DEFAULT 0,
  cancellation_policy_id uuid,
  commission_bps        int NOT NULL DEFAULT 1200,    -- 12.00 % platform fee
  stripe_account_id     text,
  rating_avg            numeric(3,2) NOT NULL DEFAULT 0,
  rating_count          int NOT NULL DEFAULT 0,
  published_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_address_or_mobile CHECK (is_mobile OR address_line1 IS NOT NULL),
  CONSTRAINT shop_radius_when_mobile CHECK (NOT is_mobile OR service_radius_m IS NOT NULL)
);
CREATE INDEX shop_geo_idx      ON shop USING gist (geo);
CREATE INDEX shop_name_trgm_idx ON shop USING gin (name gin_trgm_ops);
CREATE INDEX shop_live_idx     ON shop (kind, city) WHERE status = 'approved';
CREATE INDEX shop_chain_idx    ON shop (chain_id) WHERE chain_id IS NOT NULL;

-- Per-locale marketing copy. Falls back to shop.* when a row is absent.
CREATE TABLE shop_i18n (
  shop_id      uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  locale       text NOT NULL,                     -- 'de-DE','en-GB','tr-TR','ar-SA'
  name         text,
  tagline      text,
  description  text,
  machine_translated boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, locale)
);

CREATE TABLE shop_media (
  shop_id     uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  media_id    uuid NOT NULL REFERENCES media_asset(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'gallery',   -- gallery|logo|cover|before_after
  position    int  NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, media_id)
);

-- Weekly opening pattern. dow: 0=Sunday .. 6=Saturday (local shop time).
CREATE TABLE shop_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  dow         smallint NOT NULL CHECK (dow BETWEEN 0 AND 6),
  opens_at    time NOT NULL,
  closes_at   time NOT NULL,
  valid_from  date,
  valid_to    date,
  CONSTRAINT shop_hours_order CHECK (closes_at > opens_at)
);
CREATE INDEX shop_hours_shop_idx ON shop_hours (shop_id, dow);

CREATE TABLE shop_closure (                       -- holidays, refurbishment, ad-hoc
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  period      tstzrange NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  EXCLUDE USING gist (shop_id WITH =, period WITH &&)
);

-- ---------------------------------------------------------------------
-- Staff, resources, catalog
-- ---------------------------------------------------------------------
CREATE TABLE staff (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  user_id           uuid REFERENCES app_user(id) ON DELETE SET NULL, -- NULL = unclaimed profile
  display_name      text NOT NULL,
  title             text,                          -- 'Senior Colourist'
  bio               text,
  avatar_media_id   uuid REFERENCES media_asset(id),
  specialties       text[] NOT NULL DEFAULT '{}',
  languages         text[] NOT NULL DEFAULT '{de}',
  tier              text NOT NULL DEFAULT 'standard', -- standard|senior|master (price multiplier)
  accepts_bookings  boolean NOT NULL DEFAULT true,
  is_mobile         boolean NOT NULL DEFAULT false,
  rating_avg        numeric(3,2) NOT NULL DEFAULT 0,
  rating_count      int NOT NULL DEFAULT 0,
  employment_start  date,
  employment_end    date,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_shop_idx ON staff (shop_id) WHERE accepts_bookings;

CREATE TABLE resource (                           -- chair, wash basin, treatment room, kit
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'station',
  capacity    int  NOT NULL DEFAULT 1,
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE service_category (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  name        text NOT NULL,
  position    int NOT NULL DEFAULT 0,
  taxonomy_key text                               -- maps to global taxonomy for cross-shop search
);

CREATE TABLE service (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  category_id         uuid REFERENCES service_category(id) ON DELETE SET NULL,
  name                text NOT NULL,
  description         text,
  taxonomy_key        text,                       -- 'hair.cut.womens', 'nails.gel.fullset'
  duration_min        int  NOT NULL CHECK (duration_min > 0),
  processing_gap_min  int  NOT NULL DEFAULT 0,    -- colour develops; staff can serve others
  finish_min          int  NOT NULL DEFAULT 0,
  base_price_cents    int  NOT NULL CHECK (base_price_cents >= 0),
  vat_rate_bps        int  NOT NULL DEFAULT 1900, -- 19 % DE standard rate
  price_is_from       boolean NOT NULL DEFAULT false,
  deposit_cents       int  NOT NULL DEFAULT 0,
  max_parallel        int  NOT NULL DEFAULT 1,
  requires_patch_test boolean NOT NULL DEFAULT false,
  patch_test_hours    int,
  online_bookable     boolean NOT NULL DEFAULT true,
  mobile_available    boolean NOT NULL DEFAULT false,
  dynamic_pricing     boolean NOT NULL DEFAULT false,
  active              boolean NOT NULL DEFAULT true,
  position            int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_shop_idx     ON service (shop_id) WHERE active;
CREATE INDEX service_taxonomy_idx ON service (taxonomy_key) WHERE active AND online_bookable;

CREATE TABLE service_i18n (
  service_id  uuid NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  locale      text NOT NULL,
  name        text,
  description text,
  machine_translated boolean NOT NULL DEFAULT false,
  PRIMARY KEY (service_id, locale)
);

CREATE TABLE service_variant (                    -- hair length, nail length, add-on tiers
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id       uuid NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  label            text NOT NULL,                 -- 'Long hair'
  duration_delta_min int NOT NULL DEFAULT 0,
  price_delta_cents  int NOT NULL DEFAULT 0,
  position         int NOT NULL DEFAULT 0
);

CREATE TABLE service_addon (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id       uuid NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  name             text NOT NULL,
  duration_min     int NOT NULL DEFAULT 0,
  price_cents      int NOT NULL DEFAULT 0
);

CREATE TABLE staff_service (                      -- who may perform what, at what speed/price
  staff_id        uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id      uuid NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  duration_min    int,                            -- override
  price_cents     int,                            -- override
  proficiency     smallint NOT NULL DEFAULT 3 CHECK (proficiency BETWEEN 1 AND 5),
  PRIMARY KEY (staff_id, service_id)
);

CREATE TABLE service_resource_req (
  service_id   uuid NOT NULL REFERENCES service(id) ON DELETE CASCADE,
  resource_kind text NOT NULL,
  quantity     int NOT NULL DEFAULT 1,
  PRIMARY KEY (service_id, resource_kind)
);
