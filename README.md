# StyleNow — platform scaffold

Multi-shop beauty booking marketplace for hair salons, nail studios, barbershops,
brow/lash artists and mobile stylists. EU/Germany first: EUR, Stripe Connect +
SEPA, GDPR by construction, German and English at launch.

This repository is the **implementation scaffold** that accompanies the technical
specification. It is deliberately thin on framework glue and thick on the parts
that are genuinely hard: the availability engine, the double-booking guarantee,
dynamic pricing with guard rails, and the offline sync contract.

```
stylenow/
├── db/migrations/            5 SQL migrations — the full schema, runnable in order
├── apps/
│   ├── api/
│   │   ├── openapi.yaml      53 operations across 12 tags — the API contract
│   │   └── src/
│   │       ├── domain/       pure, dependency-free, 100 % unit-testable
│   │       │   ├── availability.ts   slot projection, buffers, travel windows
│   │       │   ├── pricing.ts        dynamic pricing + cancellation outcomes
│   │       │   ├── matching.ts       explainable smart-match ranking
│   │       │   └── __tests__/        29 checks, no test runner required
│   │       └── modules/booking/      the transactional hold → confirm flow
│   ├── web/                  Next.js consumer site + shop dashboard (App Router)
│   └── mobile/               React Native (Expo) — GPS, push, offline
├── packages/shared/          generated types, i18n catalogues, design tokens
└── infra/                    docker-compose, Terraform, k8s manifests
```

## Live demo on GitHub Pages

The repo ships a workflow (`.github/workflows/deploy-pages.yml`) that builds
the web app as a static export and publishes it to
**https://rbkangiskang.github.io/StyleNow/**. One-time setup (the Pages site
itself cannot be created by a workflow token):

1. Repo must be public (GitHub free plan only serves Pages from public repos).
2. Settings → **Pages** → Build and deployment → Source: **GitHub Actions**.
3. Actions → *Deploy web app to GitHub Pages* → **Run workflow** (or push).

Every later push deploys automatically. The published app runs entirely in
the browser — against Supabase once the schema is applied (next section),
otherwise on per-browser local storage.

## Phone installs & the app stores

Three distribution channels, one codebase:

- **Install from the website (PWA).** The site ships a web-app manifest,
  icons and a service worker — Android/desktop Chrome shows an “Install
  StyleNow” button (also in the *Get the app* section of the home page);
  iPhone installs via Share → *Add to Home Screen*. Works offline after the
  first visit. Booking creation stays online-only by design — see
  `apps/mobile/OFFLINE.md` for why a slot held offline is a slot sold twice.
- **Download for Android (.apk).** `.github/workflows/android-apk.yml`
  builds a real APK on every push (Capacitor shell bundling the web build)
  and publishes it to the `android-latest` release — the website's
  “Download for Android” button points there.
- **Store submissions.** `apps/mobile-shell` contains the native projects:
  - *Google Play*: open `apps/mobile-shell/android` in Android Studio,
    configure a signing key, build a release AAB (`./gradlew bundleRelease`),
    upload in the Play Console (one-time $25 developer fee).
  - *Apple App Store*: on a Mac, `npx cap open ios`, set your signing team in
    Xcode, archive, and upload via App Store Connect (requires the $99/year
    Apple Developer Program; there is no sideload channel on iOS — the PWA is
    the no-account path).

  The long-term native client is the React Native app specified by the
  scaffold (`apps/mobile/OFFLINE.md`); the shells are the pragmatic
  store-distribution path until it ships.

## Accounts, social login & partner registration

- **Customers** register at `/account` — name, email + password, phone,
  address, birthday, preferred language, and explicit consents (terms
  required; marketing and personalisation opt-in). Signed-in users get
  prefilled checkout, profile editing, consent management, one-click
  **data export (GDPR Art. 20)** and **account deletion (Art. 17)**.
- **Social login** (Google / Apple / Facebook): in Supabase mode the buttons
  run real OAuth via `signInWithOAuth` — enable the providers under
  Supabase → Authentication → Providers. Without Supabase the buttons create
  clearly-labelled demo sessions so the flow stays walkable.
- **Companies** register at `/partner` — a four-step onboarding wizard
  collecting legal name, category, contact, VAT ID / commercial register /
  §19 UStG flag, address or mobile-service radius, opening hours, the
  bookable service list, team size, languages, payout IBAN (stored masked;
  verification happens in Stripe Connect), cancellation/no-show/deposit
  policy, and the partner-terms + AVV consents. Applications land in
  `shop_applications` (insert-only for browsers; review with owner
  credentials — the `/admin/shops/pending` flow from the API contract).

## Supabase backend

`apps/web` talks to Supabase when configured (already wired via
`apps/web/supabase.config.json` — the publishable key is safe to commit by
design). One step remains, because DDL needs owner rights:

1. Open the Supabase dashboard → SQL Editor → paste and run
   **`db/supabase/schema.sql`**.

That creates `bookings` + `staff_occupancy` (with the GiST EXCLUDE constraint
that makes double-booking physically impossible), the dashboard config
tables, and the `create_hold` / `set_booking` RPCs. From the next page load
every visitor shares the same bookings, and a lost race for a slot comes back
as the standard conflict-with-alternatives response. Until the schema exists
the app quietly falls back to per-browser storage.

## Quick start — the product, no infrastructure needed

`apps/web` is the full product experience (consumer marketplace + booking flow
+ shop dashboard) running against an in-memory demo store that consumes the
domain modules **as-is** — same slot projection, same pricing engine, same
hold → confirm → cancel semantics, same 409-with-alternatives contract:

```bash
npm install
npm run dev        # → http://localhost:3000
```

What to try: search & filter the feed (toggle "Personalise my feed" to see the
consent-gated ranking change), book a colour service (watch slot prices move
with the shop's pricing rules), let the 8-minute hold tick, cancel inside and
outside the free window, then open **For business** and pause a pricing rule —
the consumer slot grid re-prices immediately. UI ships in English and German.

## Quick start — real infrastructure

```bash
# 1. Infrastructure (Postgres 16 with PostGIS *and* pgvector, Redis, MinIO, Mailpit)
#    The db service builds infra/Dockerfile.postgres — neither official image
#    ships the other's extension, and migration 0001 needs both.
docker compose -f infra/docker-compose.yml up -d

# 2. Schema
for f in db/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done

# 3. Domain tests — no dependencies, no runner
npx tsx apps/api/src/domain/__tests__/domain.test.ts
```

## The three invariants

Everything else in the system is negotiable. These are not.

**1 · A slot cannot be sold twice.** Not "usually", not "unless there is a race".
`staff_occupancy` and `resource_occupancy` carry GiST `EXCLUDE` constraints on
`(staff_id, tstzrange)`. Two concurrent checkouts for the same 15:00 slot end
with one transaction raising SQLSTATE `23P01`; the API turns that into a `409`
carrying six fresh alternatives, which is a far better experience than the
apology email the alternative design eventually sends.

**2 · No charge without a seat, no seat without a charge.** The hold is written
before the payment intent and carries an 8-minute expiry (long enough for a
3-D Secure round trip on a bad mobile connection). Capture happens only after
`confirmed`. Any crash in between resolves to *hold expires, money released* —
never the reverse.

**3 · Every mutation is idempotent.** `Idempotency-Key` is required on all 28
mutating operations and the response is stored against it. A retry on a flaky
S-Bahn connection returns the original booking, not a second one.

Two implementation details make invariant 1 real rather than aspirational. The
occupancy insert runs inside a `SAVEPOINT`, because a failed statement poisons
the whole transaction and the 409-with-alternatives response would otherwise be
unreachable. And the API connects as a dedicated `app_api` role with
`FORCE ROW LEVEL SECURITY` on every policy-bearing table, because RLS is bypassed
by superusers *and* by table owners — connect with the migration credentials and
you have enforced nothing.

## Where the interesting code lives

| Concern | File | Why it matters |
|---|---|---|
| Slot projection | `domain/availability.ts` | Buffers, processing gaps, granularity alignment, travel windows for mobile stylists |
| Price guard rails | `domain/pricing.ts` | Surge is capped at +25 % and never applies to a returning customer's repeat service |
| Explainable ranking | `domain/matching.ts` | Degrades gracefully without personalisation consent — the feed still works |
| The booking transaction | `modules/booking/booking.service.ts` | Hold → authorise → confirm → outbox notifications |
| Read path in SQL | `db/migrations/0005_…sql` | `find_free_slots()` — the same logic, pushed into Postgres for the cold path |

## Conventions

- **Money** is always integer minor units plus an ISO-4217 code. No floats, ever.
- **Time** is `timestamptz` in the database, epoch-ms in the domain layer, and
  RFC 3339 with offset on the wire. Local time exists only at the presentation
  edge, derived from `shop.timezone`.
- **Deletes** are soft for anything a booking references. Services are archived,
  never dropped — a two-year-old receipt must still render.
- **PII** is minimised at rest: IP addresses are stored as salted hashes, GPS
  pings live 30 days, and `retention_policy` drives an automated purge job.

## Licence

Proprietary. © StyleNow.
