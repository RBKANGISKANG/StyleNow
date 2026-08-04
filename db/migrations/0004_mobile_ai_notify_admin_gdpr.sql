-- =====================================================================
-- StyleNow — Migration 0004: mobile stylists, AI matching, notifications,
--                            admin/moderation, GDPR
-- =====================================================================

-- ---------------------------------------------------------------------
-- Mobile stylists: travel zones, trips, live tracking
-- ---------------------------------------------------------------------
CREATE TABLE travel_zone (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  name           text NOT NULL,
  area           geography(MultiPolygon,4326),      -- drawn zone, or…
  centre         geography(Point,4326),             -- …centre + radius
  radius_m       int,
  travel_fee_cents int NOT NULL DEFAULT 0,
  fee_per_km_cents int NOT NULL DEFAULT 0,
  min_order_cents int NOT NULL DEFAULT 0,
  travel_buffer_min int NOT NULL DEFAULT 20,
  active         boolean NOT NULL DEFAULT true,
  CONSTRAINT travel_zone_shape CHECK (area IS NOT NULL OR (centre IS NOT NULL AND radius_m IS NOT NULL))
);
CREATE INDEX travel_zone_area_idx ON travel_zone USING gist (area);

CREATE TABLE stylist_trip (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid NOT NULL UNIQUE REFERENCES booking(id) ON DELETE CASCADE,
  staff_id       uuid NOT NULL REFERENCES staff(id),
  status         trip_status NOT NULL DEFAULT 'scheduled',
  origin_geo     geography(Point,4326),
  dest_geo       geography(Point,4326) NOT NULL,
  planned_depart_at timestamptz,
  departed_at    timestamptz,
  eta_at         timestamptz,
  arrived_at     timestamptz,
  distance_m     int,
  route_polyline text,
  share_token    text UNIQUE,                       -- customer live-tracking link
  share_expires_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- High-volume, short-retention ping table. Partitioned WEEKLY, not monthly:
-- a partition can only be dropped once its newest row is past the retention
-- horizon, so monthly partitions would keep pings for up to ~60 days and quietly
-- break the 30-day promise in the privacy notice. Weekly bounds the overshoot to
-- 7 days, and the nightly job also DELETEs rows older than 30 days inside the
-- current partition.
CREATE TABLE trip_ping (
  trip_id     uuid NOT NULL REFERENCES stylist_trip(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL,
  geo         geography(Point,4326) NOT NULL,
  accuracy_m  real,
  heading_deg real,
  speed_mps   real,
  battery_pct smallint,
  PRIMARY KEY (trip_id, recorded_at)
) PARTITION BY RANGE (recorded_at);
CREATE TABLE trip_ping_2026w32 PARTITION OF trip_ping
  FOR VALUES FROM ('2026-08-03') TO ('2026-08-10');
CREATE TABLE trip_ping_2026w33 PARTITION OF trip_ping
  FOR VALUES FROM ('2026-08-10') TO ('2026-08-17');
CREATE TABLE trip_ping_2026w34 PARTITION OF trip_ping
  FOR VALUES FROM ('2026-08-17') TO ('2026-08-24');

-- ---------------------------------------------------------------------
-- AI smart matching
-- ---------------------------------------------------------------------
CREATE TABLE taxonomy_tag (                         -- global controlled vocabulary
  key         text PRIMARY KEY,                     -- 'hair.balayage', 'nails.gel'
  parent_key  text REFERENCES taxonomy_tag(key),
  label_de    text NOT NULL,
  label_en    text NOT NULL,
  synonyms    text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE shop_tag (
  shop_id     uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  tag_key     text NOT NULL REFERENCES taxonomy_tag(key),
  weight      real NOT NULL DEFAULT 1.0,            -- learned from bookings + reviews
  source      text NOT NULL DEFAULT 'derived',      -- declared|derived|moderated
  PRIMARY KEY (shop_id, tag_key)
);

CREATE TABLE shop_embedding (
  shop_id     uuid PRIMARY KEY REFERENCES shop(id) ON DELETE CASCADE,
  model       text NOT NULL,
  embedding   vector(768) NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shop_embedding_ann_idx ON shop_embedding
  USING hnsw (embedding vector_cosine_ops);

CREATE TABLE user_taste_profile (
  user_id        uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  embedding      vector(768),
  tag_affinity   jsonb NOT NULL DEFAULT '{}',       -- {"hair.balayage":0.82}
  price_band     int4range,
  max_travel_m   int NOT NULL DEFAULT 5000,
  preferred_dows smallint[] NOT NULL DEFAULT '{}',
  preferred_hours int4range,
  preferred_languages text[] NOT NULL DEFAULT '{}',
  consented      boolean NOT NULL DEFAULT false,    -- personalisation consent (GDPR Art. 6)
  refreshed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE match_event (                          -- training + explainability log
  id           bigserial PRIMARY KEY,
  user_id      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  session_id   uuid,
  query        jsonb NOT NULL,                      -- {intent, geo, when, budget}
  ranked_shop_ids uuid[] NOT NULL,
  scores       jsonb NOT NULL,
  model_version text NOT NULL,
  clicked_shop_id uuid,
  booked_booking_id uuid REFERENCES booking(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX match_event_user_idx ON match_event (user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Notifications (push / email / SMS / WhatsApp)
-- ---------------------------------------------------------------------
CREATE TABLE device_token (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  platform     text NOT NULL,                       -- ios|android|web
  token        text NOT NULL UNIQUE,
  locale       text,
  app_version  text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);

CREATE TABLE notification_preference (
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind         notification_kind NOT NULL,
  channel      notification_channel NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  quiet_from   time NOT NULL DEFAULT '21:00',
  quiet_to     time NOT NULL DEFAULT '08:00',
  PRIMARY KEY (user_id, kind, channel)
);

CREATE TABLE notification_template (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         notification_kind NOT NULL,
  channel      notification_channel NOT NULL,
  locale       text NOT NULL,
  subject      text,
  body         text NOT NULL,                       -- Liquid-style {{ }} placeholders
  provider_template_id text,                        -- WhatsApp HSM / Twilio content SID
  approved     boolean NOT NULL DEFAULT false,      -- WhatsApp templates need Meta approval
  UNIQUE (kind, channel, locale)
);

-- Transactional outbox. Rows are written INSIDE the same transaction as the
-- state change that justifies them, so a rollback can never leave a "confirmed"
-- SMS in the wild. A worker polls, dispatches, and marks `sent_at`.
CREATE TABLE notification_outbox (
  id            bigserial PRIMARY KEY,
  kind          notification_kind NOT NULL,
  channels      notification_channel[] NOT NULL,
  user_id       uuid REFERENCES app_user(id) ON DELETE CASCADE,
  booking_id    uuid REFERENCES booking(id) ON DELETE CASCADE,
  payload       jsonb NOT NULL DEFAULT '{}',
  send_after    timestamptz NOT NULL DEFAULT now(),
  attempts      smallint NOT NULL DEFAULT 0,
  last_error    text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_outbox_due_idx
  ON notification_outbox (send_after) WHERE sent_at IS NULL;

CREATE TABLE notification_log (
  id           bigserial,
  user_id      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  booking_id   uuid REFERENCES booking(id) ON DELETE SET NULL,
  kind         notification_kind NOT NULL,
  channel      notification_channel NOT NULL,
  locale       text,
  provider     text,
  provider_msg_id text,
  status       text NOT NULL DEFAULT 'queued',      -- queued|sent|delivered|read|failed|suppressed
  cost_cents   numeric(8,4),
  error        text,
  scheduled_for timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE notification_log_2026_08 PARTITION OF notification_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE notification_log_2026_09 PARTITION OF notification_log
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

-- ---------------------------------------------------------------------
-- Admin: onboarding, moderation, disputes
-- ---------------------------------------------------------------------
CREATE TABLE shop_application (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  submitted_by   uuid NOT NULL REFERENCES app_user(id),
  status         shop_status NOT NULL DEFAULT 'pending_review',
  checklist      jsonb NOT NULL DEFAULT '{}',       -- {identity:true, trade_licence:false, ...}
  reviewer_id    uuid REFERENCES app_user(id),
  reviewer_note  text,
  risk_score     numeric(4,3),
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz
);

CREATE TABLE verification_document (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  kind         text NOT NULL,                       -- gewerbeanmeldung|id|iban_proof|insurance|hygiene_cert
  media_id     uuid NOT NULL REFERENCES media_asset(id),
  status       text NOT NULL DEFAULT 'pending',
  expires_on   date,
  reviewed_by  uuid REFERENCES app_user(id),
  reviewed_at  timestamptz
);

CREATE TABLE dispute (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid NOT NULL REFERENCES booking(id),
  opened_by      uuid NOT NULL REFERENCES app_user(id),
  against_party  text NOT NULL,                     -- shop|customer
  category       text NOT NULL,                     -- no_show|quality|overcharge|damage|safety
  status         dispute_status NOT NULL DEFAULT 'open',
  amount_claimed_cents int,
  amount_awarded_cents int,
  assignee_id    uuid REFERENCES app_user(id),
  sla_due_at     timestamptz,
  resolution     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE INDEX dispute_queue_idx ON dispute (status, sla_due_at) WHERE status <> 'closed';

CREATE TABLE dispute_message (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id   uuid NOT NULL REFERENCES dispute(id) ON DELETE CASCADE,
  author_id    uuid REFERENCES app_user(id),
  visibility   text NOT NULL DEFAULT 'all',         -- all|internal
  body         text NOT NULL,
  attachments  uuid[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id           bigserial,
  actor_user_id uuid,
  actor_role   user_role,
  action       text NOT NULL,                       -- 'shop.approve','booking.cancel','user.export'
  entity_kind  text NOT NULL,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  ip_hash      bytea,
  request_id   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE audit_log_2026_08 PARTITION OF audit_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE feature_flag (
  key          text PRIMARY KEY,
  description  text,
  enabled      boolean NOT NULL DEFAULT false,
  rollout_pct  smallint NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  targeting    jsonb NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- GDPR machinery
-- ---------------------------------------------------------------------
CREATE TABLE consent_record (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  purpose        consent_purpose NOT NULL,
  granted        boolean NOT NULL,
  policy_version text NOT NULL,
  evidence       jsonb NOT NULL DEFAULT '{}',       -- {ui:'onboarding_step_3', ip_hash:'…'}
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_current_idx ON consent_record (user_id, purpose, created_at DESC);

CREATE TABLE data_subject_request (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES app_user(id) ON DELETE SET NULL,
  email          citext NOT NULL,
  kind           dsr_kind NOT NULL,
  status         dsr_status NOT NULL DEFAULT 'received',
  verified_at    timestamptz,
  due_at         timestamptz NOT NULL,              -- received_at + 30 days (Art. 12(3))
  handled_by     uuid REFERENCES app_user(id),
  export_media_id uuid REFERENCES media_asset(id),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);
CREATE INDEX dsr_due_idx ON data_subject_request (due_at) WHERE status NOT IN ('fulfilled','refused','withdrawn');

CREATE TABLE retention_policy (
  entity_kind    text PRIMARY KEY,
  retain_days    int NOT NULL,
  legal_basis    text NOT NULL,                     -- e.g. '§147 AO — 10y for invoices'
  action         text NOT NULL DEFAULT 'anonymise', -- anonymise|delete|archive
  last_run_at    timestamptz
);

CREATE TABLE processing_activity (                  -- Art. 30 record of processing
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  purpose        text NOT NULL,
  legal_basis    text NOT NULL,
  data_categories text[] NOT NULL,
  subjects       text[] NOT NULL,
  recipients     text[] NOT NULL DEFAULT '{}',
  third_country_transfer text,
  retention      text NOT NULL,
  security_measures text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE erasure_job (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dsr_id         uuid REFERENCES data_subject_request(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  stage          text NOT NULL DEFAULT 'queued',    -- queued|pii_scrub|media_purge|psp_notify|done
  tables_done    text[] NOT NULL DEFAULT '{}',
  blocked_reason text,                              -- e.g. open dispute, tax retention
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);
