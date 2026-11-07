/**
 * Database check: run with `npm run db:check`.
 *
 * 1. Schema drift — every table, column and RPC the Supabase transport
 *    (apps/web/src/lib/supabase-backend.ts) touches must exist in
 *    db/supabase/schema.sql.
 * 2. Data integrity — the engine's invariants over every booking and gift
 *    card, on the seeded demo data and again after a simulated busy day of
 *    holds, confirmations, cancellations, no-shows and completions.
 * 3. Live database (only when DATABASE_URL is set and psql is installed) —
 *    db/checks.sql, the same rules in SQL, against the real Postgres.
 *
 * Exits non-zero on any failure, so it can gate CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  setLocalPersistence, seedDemoIfEmpty, integritySnapshot, allShops, effectiveServices, availability,
  createHold, confirmBooking, cancelBooking, setBookingStatus, buyGiftCard, type Booking,
} from '../apps/web/src/core/store';
import { addDays, todayIso } from '../apps/web/src/core/time';
import { attachServerStore, setRequireApproval } from '../apps/web/src/core/store';
import { rowsToSnapshot, snapshotToRows } from '../apps/web/src/lib/server-persistence';

const root = path.resolve(__dirname, '..');
const problems: string[] = [];
const ok = (label: string) => console.log(`  ✓ ${label}`);
const fail = (label: string) => {
  problems.push(label);
  console.log(`  ✗ ${label}`);
};

// ---------------------------------------------------------------------------
// 1. schema drift
// ---------------------------------------------------------------------------
function schemaCheck(): void {
  console.log('Schema (db/supabase/schema.sql vs supabase-backend.ts)');
  const sql = fs.readFileSync(path.join(root, 'db/supabase/schema.sql'), 'utf8');
  const code = fs.readFileSync(path.join(root, 'apps/web/src/lib/supabase-backend.ts'), 'utf8');

  const tables = new Map<string, Set<string>>();
  for (const m of sql.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    const cols = new Set<string>();
    for (const line of m[2].split('\n')) {
      const c = line.trim().match(/^([a-z_][a-z0-9_]*)\s+(?!key\b)/i);
      if (c && !/^(constraint|primary|unique|check|foreign|exclude)$/i.test(c[1])) cols.add(c[1]);
    }
    tables.set(m[1], cols);
  }
  for (const m of sql.matchAll(/alter table (?:if exists )?public\.(\w+)\s+add column (?:if not exists )?(\w+)/gi)) {
    tables.get(m[1])?.add(m[2]);
  }
  const functions = new Set([...sql.matchAll(/create (?:or replace )?function public\.(\w+)/gi)].map((m) => m[1]));

  // Each `.from('t')` chain up to the end of its statement: the columns it filters, orders and selects.
  for (const m of code.matchAll(/\.from\('(\w+)'\)([\s\S]*?)(?=;|\n\s*\n|\.from\(|\.rpc\()/g)) {
    const [, table, chain] = m;
    const cols = tables.get(table);
    if (!cols) {
      fail(`table "${table}" is used by the app but not defined in schema.sql`);
      continue;
    }
    const used = new Set<string>();
    for (const c of chain.matchAll(/\.(?:eq|neq|gt|gte|lt|lte|in|is|order|like|ilike|contains)\('(\w+)'/g)) used.add(c[1]);
    for (const s of chain.matchAll(/\.select\('([^']*)'/g)) {
      for (const part of s[1].split(',')) {
        const name = part.trim().split(/[\s:(]/)[0];
        if (name && name !== '*' && name !== 'count') used.add(name);
      }
    }
    const missing = [...used].filter((c) => !cols.has(c));
    if (missing.length) fail(`${table}: columns used by the app but missing in schema.sql: ${missing.join(', ')}`);
    else ok(`${table}${used.size ? ` (${[...used].join(', ')})` : ''}`);
  }
  for (const m of new Set([...code.matchAll(/\.rpc\('(\w+)'/g)].map((x) => x[1]))) {
    if (functions.has(m)) ok(`rpc ${m}()`);
    else fail(`rpc ${m}() is called by the app but not defined in schema.sql`);
  }
  if (!/exclude using gist \(staff_id with =, during with &&\)/i.test(sql)) {
    fail('staff_occupancy lost its EXCLUDE constraint — double bookings would no longer be impossible');
  } else ok('staff_occupancy keeps the no-double-booking EXCLUDE constraint');
}

// ---------------------------------------------------------------------------
// 2. data integrity on the engine's own data
// ---------------------------------------------------------------------------
const ACTIVE = new Set(['hold', 'pending_payment', 'confirmed']);
const CANCELLED = new Set(['cancelled_by_customer', 'cancelled_by_shop', 'no_show']);
const STATUSES = new Set([...ACTIVE, 'completed', ...CANCELLED]);

function integrityCheck(label: string): void {
  console.log(`Integrity — ${label}`);
  const { bookings, giftCards } = integritySnapshot();
  const now = Date.now();
  const before = problems.length;
  const bad = (b: Booking, why: string) => fail(`${b.reference} (${b.status}): ${why}`);

  for (const b of bookings) {
    const q = b.quote;
    if (!STATUSES.has(b.status)) bad(b, `unknown status "${b.status}"`);
    if (!(b.endsAt > b.startsAt)) bad(b, 'ends before it starts');
    for (const [k, v] of Object.entries({ paid: b.paidCents, refunded: b.refundedCents ?? 0, total: q.totalCents, deposit: q.depositCents, vat: q.vatCents, tip: b.tipCents ?? 0 })) {
      if (!Number.isInteger(v) || v < 0) bad(b, `${k} is ${v} (must be whole, non-negative cents)`);
    }
    if (q.depositCents > q.totalCents) bad(b, `deposit ${q.depositCents} exceeds total ${q.totalCents}`);
    if (b.paidCents > q.totalCents) bad(b, `paid ${b.paidCents} exceeds total ${q.totalCents}`);
    if (q.vatCents > q.totalCents + (b.giftCents ?? 0)) bad(b, `VAT ${q.vatCents} exceeds the price`);
    if (b.status === 'hold' && !b.holdExpiresAt) bad(b, 'a hold without an expiry would block the seat forever');
    if ((b.status === 'confirmed' || b.status === 'completed') && b.holdExpiresAt) bad(b, 'confirmed but still carries a hold expiry');
    if (CANCELLED.has(b.status) && !b.cancellation) bad(b, 'cancelled without a recorded fee/refund outcome');
    if (!CANCELLED.has(b.status) && b.cancellation) bad(b, 'has a cancellation outcome but is not cancelled');
    if (b.cancellation && b.cancellation.feeCents + b.cancellation.refundCents > q.totalCents + 1) {
      bad(b, `fee + refund (${b.cancellation.feeCents + b.cancellation.refundCents}) exceed what was owed (${q.totalCents})`);
    }
    if (!b.staffRanges.length) bad(b, 'occupies no time on any chair');
  }

  // No stylist is in two places at once (live seats only, like the EXCLUDE constraint).
  const live = bookings.filter((b) => ACTIVE.has(b.status) && !(b.status === 'hold' && (b.holdExpiresAt ?? 0) < now));
  const byStaff = new Map<string, Array<{ s: number; e: number; ref: string }>>();
  for (const b of live) {
    for (const r of b.staffRanges) {
      const list = byStaff.get(b.staffId) ?? [];
      list.push({ s: r.start, e: r.end, ref: b.reference });
      byStaff.set(b.staffId, list);
    }
  }
  for (const [staff, list] of byStaff) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 1; i < list.length; i++) {
      if (list[i].s < list[i - 1].e && list[i].ref !== list[i - 1].ref) {
        fail(`double booking: ${staff} has ${list[i - 1].ref} and ${list[i].ref} overlapping`);
      }
    }
  }

  // Gift cards: the balance is exactly what was loaded minus what was spent, and never negative.
  for (const c of giftCards) {
    const spent = c.redemptions.reduce((n, r) => n + r.cents, 0);
    if (c.balanceCents < 0) fail(`gift card ${c.code}: negative balance ${c.balanceCents}`);
    if (c.balanceCents !== c.initialCents - spent) {
      fail(`gift card ${c.code}: balance ${c.balanceCents} ≠ loaded ${c.initialCents} − spent ${spent}`);
    }
  }

  if (problems.length === before) ok(`${bookings.length} bookings and ${giftCards.length} gift cards satisfy every rule`);
}

// A busy day: holds, gift-card payments, confirmations, both kinds of
// cancellation, no-shows and completions, chosen by a fixed-seed generator so
// a failure reproduces exactly.
function simulate(): void {
  let seed = 20261102;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const shops = allShops();
  let n = 0;
  for (let i = 0; i < 120; i++) {
    const shop = pick(shops);
    const svc = pick(effectiveServices(shop.id).filter((s) => s.basePriceCents > 0 && !s.requiresPatchTest && !s.consultationFirst && !s.adultsOnly));
    if (!svc) continue;
    const day = addDays(todayIso(), 2 + Math.floor(rnd() * 30));
    const dev = `dev-sim-${i % 17}`;
    const slot = pick(availability(shop.id, [svc.id], day, dev, null).slots);
    if (!slot) continue;
    try {
      const card = rnd() < 0.25 ? buyGiftCard(shop.id, dev, 1000 + Math.floor(rnd() * 8000)) : null;
      const h = createHold({ shopId: shop.id, serviceIds: [svc.id], staffId: null, startsAt: slot.start, deviceId: dev, guestName: 'Sim', idempotencyKey: `sim-${i}`, voucherCode: card?.code });
      if (rnd() < 0.1) continue; // abandoned at checkout
      confirmBooking(h.bookingId);
      const r = rnd();
      if (r < 0.2) cancelBooking(h.bookingId, { preview: false, by: 'customer' });
      else if (r < 0.3) cancelBooking(h.bookingId, { preview: false, by: 'shop' });
      else if (r < 0.4) setBookingStatus(shop.id, h.bookingId, 'no_show');
      else if (r < 0.6) setBookingStatus(shop.id, h.bookingId, 'completed');
      n++;
    } catch (e) {
      const msg = (e as Error).message;
      // Refusals the engine is supposed to make are fine; anything else is a bug.
      if (!/slot|taken|consent|deposit|patch|lead|minor|gift_insufficient|voucher/i.test(msg)) fail(`simulation step ${i} threw "${msg}"`);
    }
  }
  console.log(`  … simulated ${n} bookings through to an outcome`);
}

// ---------------------------------------------------------------------------
// 3. live database
// ---------------------------------------------------------------------------
function liveCheck(): void {
  console.log('Live database');
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('  – skipped: set DATABASE_URL to run db/checks.sql against a real Postgres');
    return;
  }
  try {
    const out = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\t', '-f', path.join(root, 'db/checks.sql')], { encoding: 'utf8' });
    const rows = out.split('\n').filter(Boolean);
    for (const row of rows) {
      const [check, count] = row.split('\t');
      if (Number(count) > 0) fail(`${check}: ${count} rows`);
      else ok(check);
    }
  } catch (e) {
    fail(`could not run db/checks.sql: ${(e as Error).message.split('\n')[0]}`);
  }
}

setLocalPersistence(false);
seedDemoIfEmpty();
schemaCheck();
integrityCheck('seeded demo data');
simulate();
integrityCheck('after a simulated busy day');
storageRoundTrip();
liveCheck();

/**
 * The server stores every record as its own row. Split the whole engine state
 * into rows and put it back together: nothing may be lost or changed.
 */
function storageRoundTrip(): void {
  console.log('\nStorage round-trip (one row per record)');
  let json = '';
  attachServerStore(null, (j) => (json = j));
  setRequireApproval(false); // any change makes the engine hand over its snapshot
  if (!json) return fail('engine produced no snapshot');
  const rows = snapshotToRows(json);
  const back = rowsToSnapshot(rows.map((r) => ({ ...r, doc: r.doc })));
  const a = JSON.parse(json) as Record<string, unknown>;
  const b = JSON.parse(back) as Record<string, unknown>;
  const kinds = new Set([...Object.keys(a), ...Object.keys(b)]);
  let bad = 0;
  for (const k of kinds) {
    // an empty list and a missing list restore the same way
    const av = JSON.stringify(a[k] ?? []), bv = JSON.stringify(b[k] ?? []);
    if (av !== bv) { bad++; fail(`collection "${k}" changed in the round-trip`); }
  }
  if (!bad) ok(`${rows.length} rows across ${kinds.size} collections restore exactly`);
  const ids = new Set(rows.map((r) => `${r.kind}\0${r.id}`));
  if (ids.size !== rows.length) fail('two records share a row key');
  else ok('every record has its own row key');
}

console.log(problems.length ? `\n${problems.length} problem(s) found.` : '\nDatabase check passed.');
process.exit(problems.length ? 1 : 0);
