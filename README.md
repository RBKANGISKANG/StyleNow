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
