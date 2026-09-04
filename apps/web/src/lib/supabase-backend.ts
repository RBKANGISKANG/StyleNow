'use client';
/**
 * Supabase transport. Postgres holds the truth for bookings, service
 * overrides and pricing-rule state; the browser mirrors it into the local
 * engine (src/core/store) so slot projection, dynamic pricing and matching
 * run on exactly the same code in every mode.
 *
 * The invariant that matters — a slot cannot be sold twice — is enforced by
 * Postgres, not by this file: `staff_occupancy` carries a GiST EXCLUDE
 * constraint (db/supabase/schema.sql) and the `create_hold` RPC surfaces the
 * 23P01 exclusion violation as `conflict`, which we translate into the same
 * SlotTaken-with-alternatives contract the rest of the app already speaks.
 *
 * Setup: run db/supabase/schema.sql in the Supabase SQL editor, then set
 * NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import * as store from '@/core/store';
import type { Booking, HoldInput, HoldResult } from '@/core/store';
import cfg from '../../supabase.config.json';

// Env wins; the checked-in config (publishable key only — safe by design)
// makes zero-setup deploys possible.
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL || cfg.url;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || cfg.publishableKey;

// Flips to true when the project is unreachable or the schema has not been
// applied yet — the app then falls back to local browser storage instead of
// breaking, and recovers on the next full reload after the schema exists.
let unavailable = false;

export function isConfigured(): boolean {
  return Boolean(URL_ && KEY) && !unavailable;
}

export function markUnavailable(reason: unknown): void {
  unavailable = true;
  console.warn('[stylenow] Supabase unavailable, falling back to local storage:', reason);
}

let client: SupabaseClient | null = null;
async function sb(): Promise<SupabaseClient> {
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    // A network that hangs must never brick the app: every Supabase request
    // gets a hard timeout, and callers degrade to local storage on failure.
    const timedFetch: typeof fetch = (input, init) =>
      fetch(input, {
        ...init,
        signal:
          typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
            ? AbortSignal.timeout(8000)
            : init?.signal ?? null,
      });
    client = createClient(URL_!, KEY!, { global: { fetch: timedFetch } });
  }
  return client;
}

interface BookingRow {
  id: string;
  data: Booking;
}

/** Hard deadline for any Supabase round trip — the client library's internal
 *  retries must never leave the UI hanging. */
function deadline<T>(p: PromiseLike<T>, ms = 10_000): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('supabase_deadline')), ms)),
  ]);
}

let synced = false;
let syncPromise: Promise<void> | null = null;

async function syncNow(): Promise<void> {
  const db = await sb();
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const [bookings, rules, overrides, logos, cats, config] = await Promise.all([
    db.from('bookings').select('id,data').gte('starts_at', since),
    db.from('rule_state').select('rule_id,enabled'),
    db.from('service_overrides').select('service_id,patch'),
    db.from('shop_logos').select('shop_id,data_url'),
    db.from('custom_categories').select('id,label'),
    db.from('shop_state').select('shop_id,data'),
  ]);
  if (bookings.error) throw bookings.error;
  store.setLocalPersistence(false); // Supabase owns the data; keep localStorage out of it
  store.applyExternalState({
    bookings: ((bookings.data ?? []) as BookingRow[]).map((r) => r.data),
    ruleDisabled: (rules.data ?? []).filter((r) => !r.enabled).map((r) => r.rule_id as string),
    serviceOverrides: (overrides.data ?? []).map((r) => [r.service_id as string, r.patch]),
    shopLogos: (logos.data ?? []).map((r) => [r.shop_id as string, r.data_url as string]),
    customCategories: (cats.data ?? []).map((r) => [r.id as string, r.label as string]),
  });
  // Team, branches, rosters, absences, closures, own services and rules, notes
  // — the shop's configuration, which used to live only in the browser that
  // typed it. A missing shop_state table is tolerated: older projects that have
  // not re-run schema.sql keep working, they just stay device-local.
  for (const row of (config.data ?? []) as Array<{ shop_id: string; data: store.ShopConfig }>) {
    try {
      store.applyShopConfig(row.shop_id, row.data);
    } catch {
      // one malformed document must not sink the whole sync
    }
  }
  synced = true;
}

export async function ensureSynced(): Promise<void> {
  if (synced) return;
  syncPromise ??= deadline(syncNow()).finally(() => {
    syncPromise = null;
  });
  await syncPromise;
}

function toRow(b: Booking) {
  return {
    id: b.id,
    shop_id: b.shopId,
    staff_id: b.staffId,
    device_id: b.deviceId,
    starts_at: new Date(b.startsAt).toISOString(),
    status: b.status,
    hold_expires_at: b.holdExpiresAt ? new Date(b.holdExpiresAt).toISOString() : null,
    guest_phone: b.guestPhone ?? null,
    guest_note: b.guestNote ?? null,
    refunded_cents: b.refundedCents ?? 0,
    review_reply: b.reviewReply ?? null,
    data: b,
  };
}

/**
 * Push this shop's configuration document.
 *
 * Called after every configuration write. Deliberately fire-and-forget from the
 * caller's point of view: the local mirror is already correct, so a failed push
 * costs a sync, not the edit. A project that has not re-run schema.sql simply
 * has no shop_state table — that is a degraded mode, not an error to surface.
 */
export async function pushShopConfig(shopId: string): Promise<void> {
  if (!shopId) return;
  try {
    const db = await sb();
    await deadline(
      db.from('shop_state').upsert({
        shop_id: shopId,
        data: store.exportShopConfig(shopId),
        updated_at: new Date().toISOString(),
      }),
    );
  } catch {
    // stays local; the next successful sync will carry it
  }
}

/**
 * Seat first, in Postgres, atomically. The local engine pre-checks against the
 * mirror (fast feedback), the RPC decides (correct under races).
 */
export async function createHold(input: HoldInput): Promise<HoldResult> {
  await ensureSynced();
  const result = store.createHold(input); // local pre-check + quote + booking row
  const booking = store.getBooking(result.bookingId)!;
  const db = await sb();
  const { data, error } = await deadline(db.rpc('create_hold', {
    p_booking: toRow(booking),
    p_ranges: booking.staffRanges.map((r) => ({
      start: new Date(r.start).toISOString(),
      end: new Date(r.end).toISOString(),
    })),
  }));
  if (error) {
    store.deleteBooking(result.bookingId);
    throw error;
  }
  if (data?.conflict) {
    // Someone on another device won the seat. Refresh the mirror and answer
    // with alternatives, exactly like the server API's 409.
    store.deleteBooking(result.bookingId);
    await syncNow();
    const { slots } = store.availability(
      input.shopId,
      input.serviceIds,
      new Date(input.startsAt).toISOString().slice(0, 10),
      input.deviceId,
    );
    throw new store.SlotTaken(slots.slice(0, 6));
  }
  return result;
}

/** Both seats of a pair, each pushed through the same atomic RPC. If the
 *  second seat loses a race, the first is rolled back too — locally and in
 *  Postgres — because a half-booked pair is worse than none. */
export async function createDuoHold(
  input: HoldInput,
  friendName: string,
): Promise<{ first: HoldResult; second: HoldResult }> {
  await ensureSynced();
  const pair = store.createDuoHold(input, friendName); // local resolution + both rows
  const db = await sb();
  const pushed: string[] = [];
  for (const r of [pair.first, pair.second]) {
    const booking = store.getBooking(r.bookingId)!;
    const { data, error } = await deadline(db.rpc('create_hold', {
      p_booking: toRow(booking),
      p_ranges: booking.staffRanges.map((x) => ({
        start: new Date(x.start).toISOString(),
        end: new Date(x.end).toISOString(),
      })),
    }));
    if (error || data?.conflict) {
      for (const id of [pair.first.bookingId, pair.second.bookingId]) store.deleteBooking(id);
      for (const id of pushed) {
        await deadline(db.rpc('set_booking', { p_id: id, p_data: null, p_release_seat: true })).catch(() => {});
      }
      await syncNow();
      const { slots } = store.availability(
        input.shopId,
        input.serviceIds,
        new Date(input.startsAt).toISOString().slice(0, 10),
        input.deviceId,
      );
      throw new store.SlotTaken(slots.filter((s) => s.staffIds.length >= 2).slice(0, 6));
    }
    pushed.push(r.bookingId);
  }
  return pair;
}

export async function confirmBooking(
  bookingId: string,
  payment?: { method: store.PaymentMethod; label: string },
): Promise<Booking> {
  const b = store.confirmBooking(bookingId, payment);
  const db = await sb();
  const { error } = await deadline(db.rpc('set_booking', { p_id: b.id, p_data: b }));
  if (error) throw error;
  return b;
}

export async function cancelBooking(
  bookingId: string,
  opts: { preview: boolean; by: 'customer' | 'shop'; isNoShow?: boolean },
): Promise<{ feeCents: number; refundCents: number; reason: string }> {
  const r = store.cancelBooking(bookingId, opts);
  if (!opts.preview) {
    const db = await sb();
    const { error } = await deadline(
      db.rpc('set_booking', { p_id: r.booking.id, p_data: r.booking, p_release_seat: true }),
    );
    if (error) throw error;
  }
  return { feeCents: r.feeCents, refundCents: r.refundCents, reason: r.reason };
}

export async function createShopBooking(
  shopId: string,
  serviceIds: string[],
  staffId: string | null,
  startsAt: number,
  guestName: string,
): Promise<Booking> {
  const hold = await createHold({
    shopId,
    serviceIds,
    staffId,
    startsAt,
    deviceId: `shop:${shopId}`,
    guestName,
    idempotencyKey: `shopbk-${shopId}-${startsAt}`,
  });
  const b = store.confirmBooking(hold.bookingId);
  b.paidCents = 0; // settled at the shop
  const db = await sb();
  const { error } = await deadline(db.rpc('set_booking', { p_id: b.id, p_data: b }));
  if (error) throw error;
  return b;
}

export async function rescheduleBooking(
  shopId: string,
  bookingId: string,
  newStartsAt: number,
  newStaffId?: string | null,
  opts: { byDevice?: string } = {},
): Promise<Booking> {
  await ensureSynced();
  const b = store.rescheduleBooking(shopId, bookingId, newStartsAt, newStaffId, opts);
  const db = await sb();
  const { data, error } = await deadline(db.rpc('reschedule_booking', {
    p_id: b.id,
    p_data: b,
    p_ranges: b.staffRanges.map((r) => ({
      start: new Date(r.start).toISOString(),
      end: new Date(r.end).toISOString(),
    })),
  }));
  if (error) throw error;
  if (data?.conflict) {
    // Lost a race against another device — refresh the mirror and re-offer.
    await syncNow();
    const { slots } = store.availability(shopId, b.serviceIds, new Date(newStartsAt).toISOString().slice(0, 10), b.deviceId);
    throw new store.SlotTaken(slots.slice(0, 6));
  }
  return b;
}

export async function setBookingStatus(
  shopId: string,
  bookingId: string,
  status: 'completed' | 'no_show' | 'cancelled_by_shop',
): Promise<void> {
  const b = store.setBookingStatus(shopId, bookingId, status);
  const db = await sb();
  const { error } = await deadline(
    db.rpc('set_booking', { p_id: b.id, p_data: b, p_release_seat: status !== 'completed' }),
  );
  if (error) throw error;
}

export async function patchService(
  shopId: string,
  serviceId: string,
  patch: { basePriceCents?: number; durationMin?: number; dynamicPricing?: boolean },
): Promise<void> {
  store.patchService(shopId, serviceId, patch);
  const merged = Object.fromEntries(store.serviceOverrideEntries())[serviceId] ?? patch;
  const db = await sb();
  const { error } = await deadline(db.from('service_overrides').upsert({ service_id: serviceId, patch: merged }));
  if (error) throw error;
}

export async function toggleRule(shopId: string, ruleId: string): Promise<void> {
  const enabled = store.toggleRule(shopId, ruleId);
  const db = await sb();
  const { error } = await deadline(db.from('rule_state').upsert({ rule_id: ruleId, enabled }));
  if (error) throw error;
}

export async function setReview(bookingId: string, rating: number, text: string): Promise<void> {
  const b = store.setReview(bookingId, rating, text);
  const db = await sb();
  const { error } = await deadline(db.rpc('set_booking', { p_id: b.id, p_data: b }));
  if (error) throw error;
}

export async function setTip(bookingId: string, tipCents: number): Promise<void> {
  const b = store.setTip(bookingId, tipCents);
  const db = await sb();
  const { error } = await deadline(db.rpc('set_booking', { p_id: b.id, p_data: b }));
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// auth & profiles (used by src/lib/auth.tsx in supabase mode)
// ---------------------------------------------------------------------------

import type { User } from '@supabase/supabase-js';
import type { Profile, SessionUser } from '@/lib/auth';

/** The shared client — auth flows need it directly. */
export async function authClient(): Promise<SupabaseClient> {
  return sb();
}

export async function loadSessionUser(u: User): Promise<SessionUser> {
  const db = await sb();
  const { data } = await deadline(db.from('profiles').select('data').eq('id', u.id).maybeSingle());
  const provider = (u.app_metadata?.provider ?? 'email') as SessionUser['provider'];
  const base: Profile = (data?.data as Profile) ?? {
    name: (u.user_metadata?.name as string) ?? u.email?.split('@')[0] ?? '',
    email: u.email ?? '',
    phone: '',
    city: '',
    postalCode: '',
    birthday: '',
    preferredLanguage: 'en',
    consents: { terms: true, marketing: false, personalisation: false },
  };
  return { ...base, id: u.id, provider, demo: false };
}

export async function saveProfile(id: string, profile: Profile): Promise<void> {
  const db = await sb();
  const { error } = await deadline(db.from('profiles').upsert({ id, data: profile }));
  if (error) throw error;
}

export async function deleteProfile(id: string): Promise<void> {
  const db = await sb();
  await deadline(db.from('profiles').delete().eq('id', id));
}

/** Partner (shop) applications — insert-only for the browser; review happens
 *  with owner credentials (the admin surface in the OpenAPI contract). */
export async function submitApplication(id: string, data: unknown): Promise<void> {
  const db = await sb();
  const { error } = await deadline(db.from('shop_applications').insert({ id, data, status: 'pending' }));
  if (error) throw error;
}

export async function setShopLogo(shopId: string, dataUrl: string | null): Promise<void> {
  store.setShopLogo(shopId, dataUrl);
  const db = await sb();
  if (dataUrl) {
    const { error } = await deadline(db.from('shop_logos').upsert({ shop_id: shopId, data_url: dataUrl }));
    if (error) throw error;
  } else {
    await deadline(db.from('shop_logos').delete().eq('shop_id', shopId));
  }
}

export async function addCustomCategory(label: string): Promise<{ id: string; label: string }> {
  const cat = store.addCustomCategory(label);
  const db = await sb();
  const { error } = await deadline(db.from('custom_categories').upsert({ id: cat.id, label: cat.label }));
  if (error) throw error;
  return cat;
}
