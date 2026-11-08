'use client';
/**
 * Backend dispatcher. One call surface, three transports:
 *
 *  - 'server'   (default `next dev`/`next start`): fetches the Next.js API
 *               routes, which run the store server-side.
 *  - 'local'    (static export, e.g. GitHub Pages): the same store runs in the
 *               browser; bookings persist in localStorage.
 *  - 'supabase' (NEXT_PUBLIC_SUPABASE_URL + _ANON_KEY set): Postgres on
 *               Supabase is the source of truth — bookings are written through
 *               RPCs guarded by a real EXCLUDE constraint, then mirrored into
 *               the local engine for slot projection and pricing.
 */
import { useEffect, useRef } from 'react';
import * as store from '@/core/store';
import type {
  ApiSlot,
  FeedCard,
  FeedQuery,
  HoldInput,
  HoldResult,
  BookingView,
  UserReview,
  ShopReview,
  ShopWaitlistRow,
  WaitlistView,
  ShopApplication,
  StaffMember,
  ShopLocation,
  HrRow,
  RosterCalendar,
  CalendarDay,
  RevenueReport,
  CustomerRow,
  ShopClosure,
  Absence,
  AbsenceKind,
  OpeningDay,
  ShopStatus,
  Opening,
  ShopPhoto,
  Message,
  ThreadSummary,
  StaffWeekDayView,
  AppNotice,
  BillingProfile,
  BookingConflict,
  PaymentMethod,
  DayCloseReport,
  GiftCard,
} from '@/core/store';
import { todayIso } from '@/core/time';
import { deviceId, newIdempotencyKey } from '@/lib/device';
import * as sb from '@/lib/supabase-backend';

type Mode = 'server' | 'local' | 'supabase';

/** JSON request to this deployment's own /api (server mode). */
function post(url: string, body: unknown, method = 'POST'): Promise<Response> {
  return fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

/** GET JSON from this deployment's /api; null when the request fails (reads degrade like an empty store). */
async function getJson(url: string): Promise<any | null> {
  const res = await fetch(url).catch(() => null);
  return res?.ok ? res.json().catch(() => null) : null;
}

/** POST a JSON query to this deployment's /api; null when it fails (for reads whose input is a list). */
async function postJson(url: string, body: unknown): Promise<any | null> {
  const res = await post(url, body).catch(() => null);
  return res?.ok ? res.json().catch(() => null) : null;
}

/** The JSON body of a server-mode write, or throw its error code — as the local engine call would. */
async function okJson(res: Response): Promise<any> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'error');
  return body;
}

export function backendMode(): Mode {
  // An explicit choice always wins. The Supabase config is checked in so that
  // a zero-setup deploy just works, which used to mean there was no way to say
  // "no, run against this deployment's own /api" — and Stripe only works
  // there, because only the server process holds the secret key and the
  // pricing engine at the same time.
  //
  // The default is this deployment's own server: real logins, salon-only
  // routes checked on the server, payments. Static builds (GitHub Pages, the
  // Android app) say NEXT_PUBLIC_BACKEND=local; Supabase-direct must be asked
  // for explicitly, because there the browser talks to the database itself.
  const want = process.env.NEXT_PUBLIC_BACKEND;
  if (want === 'local') return 'local';
  if (want === 'supabase') {
    if (sb.isConfigured()) return 'supabase';
    // Supabase dropped out mid-session: every post-ready() fallback has already
    // written to the browser store, so the rest of the session must read and
    // confirm there too — /api has never seen those bookings.
    if (sb.fellBack()) return 'local';
  }
  return 'server';
}

async function ready(): Promise<void> {
  if (backendMode() !== 'supabase') return;
  try {
    await sb.ensureSynced();
  } catch (e) {
    // Project unreachable or schema missing — degrade to local storage.
    sb.markUnavailable(e);
  }
}

/**
 * Reads must never sit behind a slow first sync. A cold Supabase round trip can
 * take seconds (or its full timeout when the project is unreachable), which
 * would leave the feed blank that whole time. So reads wait only briefly: if
 * the sync has not landed, they answer from the local mirror and the next read
 * picks up the synced data.
 */
const READ_SYNC_BUDGET_MS = 1500;

async function readyForRead(): Promise<void> {
  if (backendMode() !== 'supabase') return;
  await Promise.race([
    ready(),
    new Promise<void>((resolve) => setTimeout(resolve, READ_SYNC_BUDGET_MS)),
  ]);
}

/**
 * Writes that touch a structure the sync *does* replace (anything living on
 * `state.bookings`) still wait for it — but not forever. An unreachable project
 * used to freeze the first click of a session for the whole connection timeout
 * with no feedback at all, which reads as a dead button.
 *
 * Booking writes are deliberately NOT on this path: when Supabase is configured
 * the seat contract lives there, so they must actually reach it.
 */
const WRITE_SYNC_BUDGET_MS = 4000;

async function readyForWrite(): Promise<void> {
  if (backendMode() !== 'supabase') return;
  await Promise.race([
    ready(),
    new Promise<void>((resolve) => setTimeout(resolve, WRITE_SYNC_BUDGET_MS)),
  ]);
}

/**
 * Roster, staff, locations, closures, services, the customer's private note —
 * none of these live in Supabase, and `applyExternalState` only ever replaces
 * bookings, rule state, service overrides, logos and categories. So a write to
 * one of them cannot be clobbered by a late sync, and there is nothing to wait
 * for: it applies now. That is the difference between a button that responds
 * and one that seems broken while a dead connection times out.
 */
async function localWrite(): Promise<void> {
  // Kept async so callers read the same either way, and so the sync can be
  // reinstated here alone if any of these ever move server-side.
}

/**
 * After a configuration write, push that shop's document so the change reaches
 * the salon's other devices. Not awaited by the caller: the local mirror is
 * already correct, so a slow or failed push costs a sync, never the edit.
 */
function syncConfig(shopId: string): void {
  if (backendMode() !== 'supabase') return;
  void sb.pushShopConfig(shopId);
}

// ---- discovery -----------------------------------------------------------

export async function apiMatch(query: FeedQuery): Promise<FeedCard[]> {
  if (backendMode() === 'server') {
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(query),
    });
    return (await res.json()).shops;
  }
  await readyForRead();
  return store.feed(query);
}

export async function apiAvailability(
  shopId: string,
  serviceIds: string[],
  date: string,
  staffId: string | null,
  /** Shop-side only: also project times that have already passed, so a walk-in
   *  can be recorded after the fact. Never set from the customer flow. */
  backfill = false,
): Promise<ApiSlot[]> {
  if (backendMode() === 'server') {
    const params = new URLSearchParams({ shopId, serviceIds: serviceIds.join(','), date, deviceId: deviceId() });
    if (staffId) params.set('staffId', staffId);
    if (backfill) params.set('backfill', '1');
    const res = await fetch(`/api/availability?${params}`);
    return (await res.json()).slots ?? [];
  }
  await readyForRead();
  return store.availability(shopId, serviceIds, date, deviceId(), staffId, { backfill }).slots;
}

// ---- a shop's own page ----------------------------------------------------

export interface ShopHours {
  days: OpeningDay[];
  status: ShopStatus;
  closures: ShopClosure[];
}

export async function apiShopHours(shopId: string): Promise<ShopHours | null> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shops/${shopId}/hours`);
    return res.ok ? await res.json() : null;
  }
  await readyForRead();
  const today = todayIso();
  return {
    days: store.openingHours(shopId),
    status: store.shopStatus(shopId),
    closures: store.shopClosures(shopId).filter((c) => c.to >= today),
  };
}

export async function apiNextOpenings(shopId: string, serviceIds: string[], limit = 6): Promise<Opening[]> {
  if (serviceIds.length === 0) return [];
  if (backendMode() === 'server') {
    const params = new URLSearchParams({ serviceIds: serviceIds.join(','), deviceId: deviceId(), limit: String(limit) });
    const res = await fetch(`/api/shops/${shopId}/openings?${params}`);
    return res.ok ? (await res.json()).openings : [];
  }
  await readyForRead();
  return store.nextOpenings(shopId, serviceIds, deviceId(), { limit });
}

/**
 * When Prime can be booked on a date — the opening windows, which the booking
 * flow turns into quarter-hour steps. Prime is extra capacity, so this is the
 * only availability question it ever asks.
 */
export async function apiPrimeWindows(shopId: string, iso: string): Promise<{ startMin: number; endMin: number }[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shops/${shopId}/hours?prime=${iso}`);
    return res.ok ? ((await res.json()).primeWindows ?? []) : [];
  }
  await readyForRead();
  return store.primeWindowsFor(shopId, iso);
}

// ---- booking loop --------------------------------------------------------

export type HoldOutcome =
  | { ok: true; hold: HoldResult }
  | { ok: false; code: 'slot_taken'; alternatives: ApiSlot[] }
  | { ok: false; code: 'error' };

export async function apiHold(input: Omit<HoldInput, 'idempotencyKey' | 'deviceId'>): Promise<HoldOutcome> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch('/api/bookings/hold', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': newIdempotencyKey() },
      body: JSON.stringify({ ...input, deviceId: deviceId() }),
    });
    if (res.status === 409) return { ok: false, code: 'slot_taken', alternatives: (await res.json()).alternatives ?? [] };
    if (!res.ok) return { ok: false, code: 'error' };
    return { ok: true, hold: await res.json() };
  }
  await ready();
  const liveMode = backendMode();
  const full: HoldInput = { ...input, deviceId: deviceId(), idempotencyKey: newIdempotencyKey() };
  try {
    const hold = liveMode === 'supabase' ? await sb.createHold(full) : store.createHold(full);
    return { ok: true, hold };
  } catch (e) {
    if (e instanceof store.SlotTaken) return { ok: false, code: 'slot_taken', alternatives: e.alternatives };
    return { ok: false, code: 'error' };
  }
}

export type DuoHoldOutcome =
  | { ok: true; first: HoldResult; second: HoldResult }
  | { ok: false; code: 'slot_taken'; alternatives: ApiSlot[] }
  | { ok: false; code: 'consent_required' }
  | { ok: false; code: 'error' };

/** Two chairs, the same minute, one act — see store.createDuoHold. */
export async function apiDuoHold(
  input: Omit<HoldInput, 'idempotencyKey' | 'deviceId'>,
  friendName: string,
): Promise<DuoHoldOutcome> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch('/api/bookings/hold-duo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': newIdempotencyKey() },
      body: JSON.stringify({ ...input, friendName, deviceId: deviceId() }),
    });
    if (res.status === 409) return { ok: false, code: 'slot_taken', alternatives: (await res.json()).alternatives ?? [] };
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.error === 'duo_consent_required') return { ok: false, code: 'consent_required' };
      return { ok: false, code: 'error' };
    }
    const pair = await res.json();
    return { ok: true, first: pair.first, second: pair.second };
  }
  await ready();
  const full: HoldInput = { ...input, deviceId: deviceId(), idempotencyKey: newIdempotencyKey() };
  try {
    const pair =
      backendMode() === 'supabase' ? await sb.createDuoHold(full, friendName) : store.createDuoHold(full, friendName);
    return { ok: true, ...pair };
  } catch (e) {
    if (e instanceof store.SlotTaken) return { ok: false, code: 'slot_taken', alternatives: e.alternatives };
    if (e instanceof Error && e.message === 'duo_consent_required') return { ok: false, code: 'consent_required' };
    return { ok: false, code: 'error' };
  }
}

export type ConfirmOutcome =
  | { ok: true; reference: string }
  | { ok: false; code: 'hold_expired' | 'error' };

export async function apiConfirm(
  bookingId: string,
  payment?: { method: PaymentMethod; label: string },
): Promise<ConfirmOutcome> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch(`/api/bookings/${bookingId}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payment, deviceId: deviceId() }),
    });
    if (res.status === 410) return { ok: false, code: 'hold_expired' };
    if (!res.ok) return { ok: false, code: 'error' };
    return { ok: true, reference: (await res.json()).reference };
  }
  await ready();
  try {
    const b =
      backendMode() === 'supabase'
        ? await sb.confirmBooking(bookingId, payment)
        : store.confirmBooking(bookingId, payment);
    return { ok: true, reference: b.reference };
  } catch (e) {
    if (e instanceof store.HoldExpired) return { ok: false, code: 'hold_expired' };
    return { ok: false, code: 'error' };
  }
}

export interface CancelResult {
  feeCents: number;
  refundCents: number;
  reason: string;
}

export async function apiCancel(
  bookingId: string,
  preview: boolean,
  reason?: store.CancelReason,
): Promise<CancelResult | null> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preview, reason, deviceId: deviceId() }),
    });
    return res.ok ? await res.json() : null;
  }
  await ready();
  try {
    const r =
      backendMode() === 'supabase'
        ? await sb.cancelBooking(bookingId, { preview, by: 'customer', reason })
        : store.cancelBooking(bookingId, { preview, by: 'customer', reason });
    return { feeCents: r.feeCents, refundCents: r.refundCents, reason: r.reason };
  } catch {
    return null;
  }
}

export async function apiMyBookings(): Promise<BookingView[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/me/bookings?deviceId=${encodeURIComponent(deviceId())}`).catch(() => null);
    if (!res?.ok) return [];
    return ((await res.json().catch(() => ({}))).bookings as BookingView[] | undefined) ?? [];
  }
  await readyForRead();
  return store.bookingsForDeviceView(deviceId());
}

// ---- dashboard -----------------------------------------------------------

export type Overview = ReturnType<typeof store.dashboardOverview>;

export async function apiOverview(shopId: string, date: string): Promise<Overview | null> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/overview?date=${date}`);
    return res.ok ? await res.json() : null;
  }
  await readyForRead();
  try {
    return store.dashboardOverview(shopId, date);
  } catch {
    return null;
  }
}

export async function apiSetStatus(
  shopId: string,
  bookingId: string,
  status: 'completed' | 'no_show' | 'cancelled_by_shop',
  settledBy?: 'cash' | 'card',
): Promise<void> {
  const mode = backendMode();
  if (mode === 'server') {
    // Same contract as the local/supabase branches: a refusal throws.
    const res = await fetch(`/api/shop/${shopId}/bookings/${bookingId}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, settledBy }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'status_failed');
    return;
  }
  await ready();
  if (backendMode() === 'supabase') await sb.setBookingStatus(shopId, bookingId, status, settledBy);
  else store.setBookingStatus(shopId, bookingId, status, settledBy);
}

/** Does this salon let a guest settle at the counter? */
export async function apiPayAtSalon(shopId: string): Promise<boolean> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/policies`);
    return res.ok ? (await res.json()).payAtSalon : true;
  }
  await readyForRead();
  return store.payAtSalonOf(shopId);
}

export async function apiSetPayAtSalon(shopId: string, on: boolean): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/policies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payAtSalon: on }),
    });
    return;
  }
  await localWrite();
  store.setPayAtSalon(shopId, on);
  syncConfig(shopId);
}

/**
 * Is there a real processor behind this deployment?
 *
 * Only the server mode can hold a secret key, so the static export and the
 * Supabase mode always answer no and keep the demo checkout — which is the
 * honest answer, not a degradation: nothing there can take a real payment.
 */
export async function apiStripeConfig(): Promise<{ enabled: boolean; publishableKey: string }> {
  const off = { enabled: false, publishableKey: '' };
  if (backendMode() !== 'server') return off;
  try {
    const res = await fetch('/api/stripe/config');
    return res.ok ? await res.json() : off;
  } catch {
    return off;
  }
}

export async function apiPatchService(
  shopId: string,
  serviceId: string,
  patch: { basePriceCents?: number; durationMin?: number; dynamicPricing?: boolean; categoryId?: string; requiresPatchTest?: boolean; consultationFirst?: boolean; resource?: 'basin' | 'colour' | null },
): Promise<void> {
  const mode = backendMode();
  if (mode === 'server') {
    await fetch(`/api/shop/${shopId}/services/${serviceId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return;
  }
  await ready();
  if (backendMode() === 'supabase') await sb.patchService(shopId, serviceId, patch);
  else store.patchService(shopId, serviceId, patch);
}

export async function apiToggleRule(shopId: string, ruleId: string): Promise<void> {
  const mode = backendMode();
  if (mode === 'server') {
    await fetch(`/api/shop/${shopId}/pricing-rules/${ruleId}`, { method: 'PATCH' });
    return;
  }
  await ready();
  if (backendMode() === 'supabase') await sb.toggleRule(shopId, ruleId);
  else store.toggleRule(shopId, ruleId);
}

// ---- reviews, tips, loyalty, waitlist -------------------------------------

export async function apiShopReviews(shopId: string): Promise<UserReview[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shops/${shopId}/reviews`);
    return res.ok ? (await res.json()).reviews : [];
  }
  await readyForRead();
  return store.userReviewsForShop(shopId);
}

export async function apiSetReview(
  bookingId: string,
  rating: number,
  text: string,
  tags?: store.ReviewTag[],
): Promise<boolean> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch(`/api/bookings/${bookingId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating, text, tags, deviceId: deviceId() }),
    });
    return res.ok;
  }
  await ready();
  try {
    if (backendMode() === 'supabase') await sb.setReview(bookingId, rating, text, tags);
    else store.setReview(bookingId, rating, text, tags);
    return true;
  } catch {
    return false;
  }
}

export async function apiSetTip(bookingId: string, tipCents: number): Promise<boolean> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch(`/api/bookings/${bookingId}/tip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipCents, deviceId: deviceId() }),
    });
    return res.ok;
  }
  await ready();
  try {
    if (backendMode() === 'supabase') await sb.setTip(bookingId, tipCents);
    else store.setTip(bookingId, tipCents);
    return true;
  } catch {
    return false;
  }
}

export async function apiLoyaltyBalance(): Promise<number> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/me/loyalty?deviceId=${encodeURIComponent(deviceId())}`);
    return res.ok ? (await res.json()).points : 0;
  }
  await readyForRead();
  return store.loyaltyBalance(deviceId());
}

export async function apiWaitlistJoin(shopId: string, serviceIds: string[], isoDate: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId(), shopId, serviceIds, isoDate }),
    });
    return;
  }
  await localWrite();
  store.joinWaitlist(deviceId(), shopId, serviceIds, isoDate);
}

export async function apiWaitlistLeave(id: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/waitlist/${id}?deviceId=${encodeURIComponent(deviceId())}`, { method: 'DELETE' });
    return;
  }
  await localWrite();
  store.leaveWaitlist(id);
}

export async function apiMyWaitlist(): Promise<WaitlistView[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/waitlist?deviceId=${encodeURIComponent(deviceId())}`);
    return res.ok ? (await res.json()).entries : [];
  }
  await readyForRead();
  return store.waitlistForDevice(deviceId());
}

// ---- partner registration -------------------------------------------------

/** A submitted application; `shop` is set when it went live at once (auto-approval). */
export type PartnerApplyResult = ShopApplication & { shop?: { id: string; slug: string } | null };

export async function apiPartnerApply(data: Record<string, unknown>, payout?: { iban: string }): Promise<PartnerApplyResult | null> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch('/api/partner/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // the full IBAN goes to the server only to be handed to Stripe — never stored
      body: JSON.stringify({ deviceId: deviceId(), data, payout }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return { ...body.application, shop: body.shop ?? null };
  }
  await localWrite();
  const app = store.submitShopApplication(deviceId(), data);
  if (backendMode() === 'supabase') {
    try {
      await sb.submitApplication(app.id, { ...data, deviceId: deviceId() });
    } catch (e) {
      console.warn('[stylenow] application stored locally only:', e);
    }
  }
  const live = app.shopId ? store.shopById(app.shopId) : undefined;
  return { ...app, shop: live ? { id: live.id, slug: live.slug } : null };
}

export async function apiMyApplications(): Promise<ShopApplication[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/partner/apply?deviceId=${encodeURIComponent(deviceId())}`);
    return res.ok ? (await res.json()).applications : [];
  }
  await readyForRead();
  return store.applicationsForDevice(deviceId());
}

// ---- shop-side booking creation (walk-in / phone customers) ---------------

export type ShopBookingOutcome =
  | { ok: true; reference: string }
  | { ok: false; code: 'slot_taken'; alternatives: ApiSlot[] }
  | { ok: false; code: 'consent_required' }
  | { ok: false; code: 'error' };

export async function apiShopCreateBooking(
  shopId: string,
  serviceIds: string[],
  staffId: string | null,
  startsAt: number,
  guestName: string,
  contact?: { phone?: string; note?: string; consentName?: string },
): Promise<ShopBookingOutcome> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch(`/api/shop/${shopId}/bookings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serviceIds, staffId, startsAt, guestName, ...contact }),
    });
    if (res.status === 409) return { ok: false, code: 'slot_taken', alternatives: (await res.json()).alternatives ?? [] };
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.error === 'consent_required') return { ok: false, code: 'consent_required' };
      return { ok: false, code: 'error' };
    }
    return { ok: true, reference: (await res.json()).reference };
  }
  await ready();
  try {
    const b =
      backendMode() === 'supabase'
        ? await sb.createShopBooking(shopId, serviceIds, staffId, startsAt, guestName)
        : store.createShopBooking(shopId, serviceIds, staffId, startsAt, guestName, contact);
    return { ok: true, reference: b.reference };
  } catch (e) {
    if (e instanceof store.SlotTaken) return { ok: false, code: 'slot_taken', alternatives: e.alternatives };
    if (e instanceof Error && e.message === 'consent_required') return { ok: false, code: 'consent_required' };
    return { ok: false, code: 'error' };
  }
}

export async function apiRescheduleBooking(
  shopId: string,
  bookingId: string,
  startsAt: number,
  staffId: string | null,
): Promise<ShopBookingOutcome> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch(`/api/shop/${shopId}/bookings/${bookingId}/reschedule`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startsAt, staffId }),
    });
    if (res.status === 409) return { ok: false, code: 'slot_taken', alternatives: (await res.json()).alternatives ?? [] };
    if (!res.ok) return { ok: false, code: 'error' };
    return { ok: true, reference: bookingId };
  }
  await ready();
  try {
    if (backendMode() === 'supabase') await sb.rescheduleBooking(shopId, bookingId, startsAt, staffId);
    else store.rescheduleBooking(shopId, bookingId, startsAt, staffId);
    return { ok: true, reference: bookingId };
  } catch (e) {
    if (e instanceof store.SlotTaken) return { ok: false, code: 'slot_taken', alternatives: e.alternatives };
    return { ok: false, code: 'error' };
  }
}

/**
 * The customer moves their own appointment. Same seat machinery the front desk
 * uses, plus two rules the desk is not bound by: it must be this device's
 * booking, and it must still be inside the free-cancellation window — later
 * than that, moving would just be fee-dodging with extra steps.
 */
export async function apiMoveMyBooking(
  shopId: string,
  bookingId: string,
  startsAt: number,
): Promise<ShopBookingOutcome | { ok: false; code: 'too_late' }> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch(`/api/bookings/${bookingId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId, startsAt, deviceId: deviceId() }),
    });
    if (res.status === 409) return { ok: false, code: 'slot_taken', alternatives: (await res.json()).alternatives ?? [] };
    if (res.status === 403) {
      // 403 covers both "window closed" and "not your booking" — only the
      // first one should show the too-late explanation.
      const err = (await res.json().catch(() => ({}) as { error?: string })).error;
      return err === 'too_late' ? { ok: false, code: 'too_late' } : { ok: false, code: 'error' };
    }
    if (!res.ok) return { ok: false, code: 'error' };
    announceMessages();
    return { ok: true, reference: bookingId };
  }
  await ready();
  try {
    if (backendMode() === 'supabase') {
      await sb.rescheduleBooking(shopId, bookingId, startsAt, null, { byDevice: deviceId() });
    } else {
      store.rescheduleBooking(shopId, bookingId, startsAt, null, { byDevice: deviceId() });
    }
    announceMessages();
    return { ok: true, reference: bookingId };
  } catch (e) {
    if (e instanceof store.SlotTaken) return { ok: false, code: 'slot_taken', alternatives: e.alternatives };
    if (e instanceof Error && e.message === 'too_late') return { ok: false, code: 'too_late' };
    return { ok: false, code: 'error' };
  }
}

/**
 * Book the standing appointment: the same slot every N weeks, `count` times.
 * Full dates are skipped and reported, never silently shifted.
 */
export async function apiBookSeries(
  bookingId: string,
  everyWeeks: number,
  count: number,
): Promise<{ ok: true; booked: number; skippedDates: number[] } | { ok: false }> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/bookings/${bookingId}/series`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ everyWeeks, count, deviceId: deviceId() }),
    });
    if (!res.ok) return { ok: false };
    const d = await res.json();
    announceMessages();
    return { ok: true, booked: d.booked, skippedDates: d.skippedDates ?? [] };
  }
  await ready();
  try {
    // Series members go through the engine's own hold-and-confirm path, so the
    // no-double-booking contract holds locally and in server mode. Supabase
    // mode books against the synced mirror; wiring each member through the
    // seat RPC is the one piece a real launch still owes this feature.
    const r = store.bookSeries(deviceId(), bookingId, everyWeeks, count);
    announceMessages();
    return { ok: true, booked: r.booked.length, skippedDates: r.skippedDates };
  } catch {
    return { ok: false };
  }
}

// ---- shop logo ------------------------------------------------------------

export async function apiShopLogo(shopId: string): Promise<string | null> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/logo`);
    return res.ok ? (await res.json()).logoUrl : null;
  }
  await readyForRead();
  return store.getShopLogo(shopId);
}

export async function apiSetShopLogo(shopId: string, dataUrl: string | null): Promise<void> {
  const mode = backendMode();
  if (mode === 'server') {
    await fetch(`/api/shop/${shopId}/logo`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    });
    return;
  }
  await ready();
  if (backendMode() === 'supabase') await sb.setShopLogo(shopId, dataUrl);
  else store.setShopLogo(shopId, dataUrl);
}

// ---- shop photos ----------------------------------------------------------

export async function apiShopPhotos(shopId: string): Promise<ShopPhoto[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/photos`);
    return res.ok ? (await res.json()).photos : [];
  }
  await readyForRead();
  return store.shopPhotos(shopId);
}

export type PhotoError = 'photo_limit' | 'photo_storage_full' | 'error';

export async function apiAddShopPhoto(
  shopId: string,
  dataUrl: string,
  caption = '',
): Promise<{ ok: true } | { ok: false; code: PhotoError }> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/photos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl, caption }),
    });
    if (res.ok) return { ok: true };
    const code = (await res.json().catch(() => ({}))).error;
    return { ok: false, code: code === 'photo_limit' ? 'photo_limit' : 'error' };
  }
  await ready();
  try {
    store.addShopPhoto(shopId, dataUrl, caption);
    syncConfig(shopId);
    return { ok: true };
  } catch (e) {
    // The one failure worth naming: the browser refused to keep the picture.
    if (e instanceof store.PhotoStorageFull) return { ok: false, code: 'photo_storage_full' };
    return { ok: false, code: e instanceof Error && e.message === 'photo_limit' ? 'photo_limit' : 'error' };
  }
}

export async function apiRemoveShopPhoto(shopId: string, photoId: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/photos?photoId=${encodeURIComponent(photoId)}`, { method: 'DELETE' });
    return;
  }
  await ready();
  store.removeShopPhoto(shopId, photoId);
  syncConfig(shopId);
}

export async function apiMakeShopCover(shopId: string, photoId: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/photos`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ photoId, cover: true }),
    });
    return;
  }
  await ready();
  store.makeShopCover(shopId, photoId);
  syncConfig(shopId);
}

export async function apiCaptionShopPhoto(shopId: string, photoId: string, caption: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/photos`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ photoId, caption }),
    });
    return;
  }
  await ready();
  store.captionShopPhoto(shopId, photoId, caption);
  syncConfig(shopId);
}

// ---- one stylist's week ----------------------------------------------------

export async function apiStaffWeek(shopId: string, staffId: string, fromIso: string): Promise<StaffWeekDayView[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/staff-week?staffId=${encodeURIComponent(staffId)}&from=${fromIso}`);
    return res.ok ? (await res.json()).days : [];
  }
  await readyForRead();
  return store.staffWeek(shopId, staffId, fromIso);
}

// ---- messages -------------------------------------------------------------

/**
 * Anything that changes an unread count announces it.
 *
 * The badge on the Messages tab polls, because nothing here pushes. Polling is
 * fine for a message that arrives from the other side — nobody expects that
 * within the second — but it is wrong for your own actions: reading a thread
 * and then watching the tab insist you still have one unread for another twenty
 * seconds makes the badge look broken. So local changes ring a bell.
 */
export const MESSAGES_CHANGED = 'stylenow:messages';

function announceMessages(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MESSAGES_CHANGED));
}

/**
 * Re-run `fn` whenever anything in this tab changes a message.
 *
 * Every list that shows an unread count subscribes, rather than each one being
 * told by whichever component happened to cause the change. Passing the news
 * down through callbacks worked most of the time and lost the race the rest —
 * a thread marking itself read while the list was still fetching left the old
 * count on screen until the next poll.
 */
export function useMessagesChanged(fn: () => void): void {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    const run = () => latest.current();
    window.addEventListener(MESSAGES_CHANGED, run);
    return () => window.removeEventListener(MESSAGES_CHANGED, run);
  }, []);
}

export async function apiThread(shopId: string, customerKey: string): Promise<Message[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/messages?shopId=${shopId}&customerKey=${encodeURIComponent(customerKey)}`);
    return res.ok ? (await res.json()).messages : [];
  }
  await readyForRead();
  return store.messageThread(shopId, customerKey);
}

export async function apiSendMessage(
  shopId: string,
  customerKey: string,
  from: 'shop' | 'customer',
  text: string,
): Promise<Message | null> {
  if (backendMode() === 'server') {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId, customerKey, from, text }),
    });
    const msg = res.ok ? (await res.json()).message : null;
    announceMessages();
    return msg;
  }
  await localWrite();
  const msg = store.sendMessage(shopId, customerKey, from, text);
  syncConfig(shopId);
  announceMessages();
  return msg;
}

export async function apiMarkThreadRead(
  shopId: string,
  customerKey: string,
  reader: 'shop' | 'customer',
): Promise<void> {
  if (backendMode() === 'server') {
    await fetch('/api/messages', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId, customerKey, reader }),
    });
    announceMessages();
    return;
  }
  await localWrite();
  store.markThreadRead(shopId, customerKey, reader);
  syncConfig(shopId);
  announceMessages();
}

export async function apiShopThreads(shopId: string): Promise<ThreadSummary[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/messages/threads?shopId=${shopId}`);
    return res.ok ? (await res.json()).threads : [];
  }
  await readyForRead();
  return store.shopThreads(shopId);
}

/**
 * Just the count.
 *
 * The badge used to ask for the whole thread list, which builds every customer
 * row for the shop — a scan of twelve weeks of bookings to render a number.
 * Counting unread messages only touches the message threads themselves.
 */
export async function apiShopUnread(shopId: string): Promise<number> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/messages/threads?shopId=${shopId}&count=1`);
    return res.ok ? ((await res.json()).unread ?? 0) : 0;
  }
  await readyForRead();
  return store.unreadForShop(shopId);
}

export async function apiMyUnread(): Promise<number> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/messages/threads?deviceId=${encodeURIComponent(deviceId())}&count=1`);
    return res.ok ? ((await res.json()).unread ?? 0) : 0;
  }
  await readyForRead();
  return store.unreadForDevice(deviceId());
}

/** The customer's own conversations — one per salon they have booked with. */
export async function apiMyThreads(): Promise<ThreadSummary[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/messages/threads?deviceId=${encodeURIComponent(deviceId())}`);
    return res.ok ? (await res.json()).threads : [];
  }
  await readyForRead();
  return store.threadsForDevice(deviceId());
}

// ---- billing / receipts ---------------------------------------------------

export async function apiBillingProfile(shopId: string): Promise<BillingProfile> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/billing`);
    if (res.ok) return (await res.json()).billing;
  } else {
    await readyForRead();
  }
  return store.billingProfile(shopId);
}

export async function apiSetBillingProfile(shopId: string, profile: BillingProfile): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/billing`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(profile),
    });
    return;
  }
  await localWrite();
  store.setBillingProfile(shopId, profile);
  syncConfig(shopId);
}

// ---- notifications --------------------------------------------------------

/**
 * Everything worth a glance, both hats at once.
 *
 * The demo deliberately lets one browser be customer and operator, so the bell
 * merges the two sides: your own upcoming appointments and replies, plus — if
 * this account runs shops — what customers just did there. Each notice carries
 * its shop, so the panel can say which hat it belongs to.
 */
export async function apiMyNotices(ownerKey: string | null): Promise<AppNotice[]> {
  if (backendMode() === 'server') {
    const params = new URLSearchParams({ deviceId: deviceId() });
    // Shop ownership is claimed in the browser store, never on the server —
    // resolve the ids here and send them, or the server finds no shops.
    const owned = ownerKey ? store.shopsForOwner(ownerKey) : [];
    if (owned.length) params.set('shops', owned.join(','));
    const res = await fetch(`/api/notices?${params}`);
    return res.ok ? (await res.json()).notices : [];
  }
  await readyForRead();
  const own = store.noticesForDevice(deviceId());
  const shopIds = ownerKey ? store.shopsForOwner(ownerKey) : [];
  const forShops = shopIds.flatMap((id) => store.noticesForShop(id));
  return [...own, ...forShops].sort((a, b) => b.at - a.at);
}

// ---- shop backup & restore ------------------------------------------------

/** The shop's whole configuration as one downloadable document. */
export async function apiShopBackup(shopId: string, ownerKey: string): Promise<store.ShopConfig | null> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/backup?ownerKey=${encodeURIComponent(ownerKey)}`))?.doc ?? null;
  }
  await readyForRead();
  try {
    return store.exportShopConfig(shopId);
  } catch {
    return null;
  }
}

export async function apiShopRestore(shopId: string, doc: store.ShopConfig, ownerKey: string): Promise<boolean> {
  if (backendMode() === 'server') {
    return (await post(`/api/shop/${shopId}/backup`, { doc, ownerKey })).ok;
  }
  await localWrite();
  try {
    store.restoreShopConfig(shopId, doc);
    syncConfig(shopId); // the restored state must reach the shop's other devices too
    return true;
  } catch {
    return false;
  }
}

// ---- the Stempelkarte -----------------------------------------------------

export async function apiStampStatus(shopId: string): Promise<store.StampStatus> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/stamps?deviceId=${encodeURIComponent(deviceId())}`))?.status ?? { enabled: false, required: 10, stamps: 0, redeemed: 0, rewardsAvailable: 0 };
  }
  await readyForRead();
  return store.stampStatus(shopId, deviceId());
}

export async function apiMyStampCards(): Promise<ReturnType<typeof store.myStampCards>> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/me/stamps?deviceId=${encodeURIComponent(deviceId())}`))?.cards ?? [];
  }
  await readyForRead();
  return store.myStampCards(deviceId());
}

export async function apiSetStampSettings(shopId: string, settings: { enabled: boolean; required: number }): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/stamps`, settings, 'PATCH'));
    return;
  }
  await localWrite();
  store.setStampSettings(shopId, settings);
  syncConfig(shopId);
}

// ---- twenty-features batch ------------------------------------------------

export async function apiToggleVip(shopId: string, customerKey: string): Promise<boolean> {
  if (backendMode() === 'server') {
    return (await okJson(await post(`/api/shop/${shopId}/vips`, { customerKey }))).vip;
  }
  await localWrite();
  const on = store.toggleVip(shopId, customerKey);
  syncConfig(shopId);
  return on;
}

export async function apiShopGoal(shopId: string): Promise<number> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/settings`))?.goal ?? 0;
  }
  await readyForRead();
  return store.shopGoal(shopId);
}

export async function apiSetShopGoal(shopId: string, cents: number): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/settings`, { goal: cents }, 'PATCH'));
    return;
  }
  await localWrite();
  store.setShopGoal(shopId, cents);
  syncConfig(shopId);
}

export async function apiSellGiftCard(shopId: string, amountCents: number, toName?: string): Promise<GiftCard | null> {
  if (backendMode() === 'server') {
    const res = await post(`/api/shop/${shopId}/giftcards`, { amountCents, toName }, 'PUT');
    return res.ok ? (await res.json()).card : null;
  }
  await localWrite();
  try {
    return store.sellGiftCardAtCounter(shopId, amountCents, toName);
  } catch {
    return null;
  }
}

// ---- ten-features batch ---------------------------------------------------

/** The customer's private memo on their own past visit. */
export async function apiSetCustomerMemo(bookingId: string, text: string): Promise<boolean> {
  if (backendMode() === 'server') {
    const res = await post(`/api/bookings/${bookingId}/memo`, { text, deviceId: deviceId() });
    return res.ok;
  }
  await localWrite();
  try {
    store.setCustomerMemo(bookingId, deviceId(), text);
    return true;
  } catch {
    return false;
  }
}

/** A message to the shop straight from one of the customer's bookings. */
export async function apiSendBookingMessage(bookingId: string, text: string): Promise<boolean> {
  if (backendMode() === 'server') {
    const res = await post(`/api/bookings/${bookingId}/message`, { text, deviceId: deviceId() });
    if (res.ok) announceMessages();
    return res.ok;
  }
  await localWrite();
  try {
    const msg = store.sendBookingMessage(bookingId, deviceId(), text);
    announceMessages();
    return msg !== null;
  } catch {
    return false;
  }
}

export async function apiDayForecast(shopId: string): Promise<Array<{ iso: string; pct: number }>> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/reports?view=forecast`))?.data ?? [];
  }
  await readyForRead();
  return store.dayLoadForecast(shopId);
}

/** The heat behind a month of calendar cells — -1 marks unbookable days. */
export async function apiDayLoadRange(shopId: string, fromIso: string, count: number): Promise<Array<{ iso: string; pct: number }>> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/reports?view=load-range&from=${fromIso}&count=${count}`))?.data ?? [];
  }
  await readyForRead();
  return store.dayLoadRange(shopId, fromIso, count);
}

export async function apiShopTrust(shopId: string): Promise<ReturnType<typeof store.shopTrust>> {
  if (backendMode() === 'server') {
    const t = (await getJson(`/api/shop/${shopId}/reports?view=trust`))?.data;
    if (t) return t;
  }
  await readyForRead();
  return store.shopTrust(shopId);
}

export async function apiQuietWindows(shopId: string): Promise<ReturnType<typeof store.quietWindows>> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/reports?view=quiet-windows`))?.data ?? [];
  }
  await readyForRead();
  return store.quietWindows(shopId);
}

export async function apiMyReferralCode(): Promise<string> {
  if (backendMode() === 'server') {
    return (await okJson(await post('/api/me/lifecycle', { deviceId: deviceId() }))).code;
  }
  await localWrite(); // registering the code is a write
  return store.myReferralCode(deviceId());
}

export async function apiShopAnnouncement(shopId: string): Promise<string> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/settings`))?.announcement ?? '';
  }
  await readyForRead();
  return store.shopAnnouncement(shopId);
}

export async function apiSetShopAnnouncement(shopId: string, text: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/settings`, { announcement: text }, 'PATCH'));
    return;
  }
  await localWrite();
  store.setShopAnnouncement(shopId, text);
  syncConfig(shopId); // the banner must reach customers via the shop document
}

// ---- gift cards -----------------------------------------------------------

export async function apiBuyGiftCard(
  shopId: string,
  amountCents: number,
  opts: { toName?: string; fromName?: string; message?: string },
  payment?: { method: PaymentMethod; label: string },
): Promise<GiftCard | null> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/giftcards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amountCents, ...opts, payment, deviceId: deviceId() }),
    });
    return res.ok ? (await res.json()).card : null;
  }
  await localWrite();
  try {
    return store.buyGiftCard(shopId, deviceId(), amountCents, opts, payment);
  } catch {
    return null;
  }
}

export async function apiMyGiftCards(): Promise<GiftCard[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/me/giftcards?deviceId=${encodeURIComponent(deviceId())}`);
    return res.ok ? (await res.json()).cards : [];
  }
  await readyForRead();
  return store.giftCardsForDevice(deviceId());
}

export async function apiShopGiftCards(
  shopId: string,
): Promise<{ soldCount: number; soldCents: number; outstandingCents: number; cards: GiftCard[] } | null> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/giftcards`);
    return res.ok ? await res.json() : null;
  }
  await readyForRead();
  return store.giftCardsForShop(shopId);
}

// ---- custom categories ----------------------------------------------------

export async function apiCustomCategories(): Promise<Array<{ id: string; label: string }>> {
  if (backendMode() === 'server') {
    const res = await fetch('/api/categories');
    return res.ok ? (await res.json()).categories : [];
  }
  await readyForRead();
  return store.customCategories();
}

export async function apiAddCustomCategory(label: string): Promise<{ id: string; label: string } | null> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    return res.ok ? (await res.json()).category : null;
  }
  await ready();
  try {
    return backendMode() === 'supabase' ? await sb.addCustomCategory(label) : store.addCustomCategory(label);
  } catch {
    return store.addCustomCategory(label);
  }
}

// ---- shop ownership (dashboard scoping) -----------------------------------

export async function apiMyShops(ownerKey: string): Promise<string[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/me/shops?ownerKey=${encodeURIComponent(ownerKey)}`))?.shopIds ?? [];
  }
  await readyForRead();
  return store.shopsForOwner(ownerKey);
}

export async function apiClaimShop(shopId: string, ownerKey: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/owner`, { ownerKey }));
    return;
  }
  await localWrite();
  store.claimShop(shopId, ownerKey);
  syncConfig(shopId);
}

export async function apiReleaseShop(shopId: string, ownerKey: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await fetch(`/api/shop/${shopId}/owner?ownerKey=${encodeURIComponent(ownerKey)}`, { method: 'DELETE' }));
    return;
  }
  await localWrite();
  store.releaseShop(shopId, ownerKey);
  syncConfig(shopId);
}

/** Store the answers given before a deletion; never blocks the deletion itself. */
export async function apiRecordExitFeedback(
  kind: 'account' | 'shop',
  subject: string,
  answers: Record<string, string>,
): Promise<void> {
  try {
    if (backendMode() === 'server') {
      await okJson(await post('/api/feedback/exit', { kind, subject, answers }));
      return;
    }
    await localWrite();
    store.recordExitFeedback(kind, subject, answers);
  } catch {
    // feedback is a nice-to-have — losing it must never strand the deletion
  }
}

// ---- service & pricing-rule management ------------------------------------

export async function apiAddService(
  shopId: string,
  input: {
    name: string;
    emoji: string;
    basePriceCents: number;
    durationMin: number;
    processingGapMin?: number;
    dynamicPricing?: boolean;
    categoryId?: string;
  },
): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/services`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return;
  }
  await localWrite();
  store.addService(shopId, input);
  syncConfig(shopId);
}

export async function apiArchiveService(shopId: string, serviceId: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/services/${serviceId}`, { method: 'DELETE' });
    return;
  }
  await localWrite();
  store.archiveService(shopId, serviceId);
  syncConfig(shopId);
}

export async function apiShopServices(shopId: string) {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/services`);
    return res.ok ? (await res.json()).services : [];
  }
  await readyForRead();
  return store.effectiveServices(shopId);
}

export async function apiAddPricingRule(shopId: string, rule: Record<string, unknown>): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/pricing-rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rule),
    });
    return;
  }
  await localWrite();
  store.addPricingRule(shopId, rule as Parameters<typeof store.addPricingRule>[1]);
  syncConfig(shopId);
}

export async function apiUpdatePricingRule(shopId: string, ruleId: string, patch: Record<string, unknown>): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/pricing-rules/${ruleId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return;
  }
  await localWrite();
  store.updatePricingRule(shopId, ruleId, patch);
  syncConfig(shopId);
}

export async function apiDeletePricingRule(shopId: string, ruleId: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/pricing-rules/${ruleId}`, { method: 'DELETE' });
    return;
  }
  await localWrite();
  store.deletePricingRule(shopId, ruleId);
  syncConfig(shopId);
}

// ---- team (staff) & locations ---------------------------------------------

export async function apiShopStaff(shopId: string): Promise<StaffMember[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/staff`);
    return res.ok ? (await res.json()).staff : [];
  }
  await readyForRead();
  return store.effectiveStaff(shopId);
}

export async function apiAddStaff(
  shopId: string,
  input: { name: string; role: string; tier?: 'senior' | 'stylist'; locationId?: string },
): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/staff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return;
  }
  await localWrite();
  store.addStaff(shopId, input);
  syncConfig(shopId);
}

export async function apiPatchStaff(shopId: string, staffId: string, patch: Partial<StaffMember>): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/staff/${staffId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return;
  }
  await localWrite();
  store.patchStaff(shopId, staffId, patch);
  syncConfig(shopId);
}

export type ArchiveStaffResult = { ok: true } | { ok: false; reason: 'last_staff' | 'has_bookings' | 'error' };

export async function apiArchiveStaff(shopId: string, staffId: string): Promise<ArchiveStaffResult> {
  const asReason = (msg: string): ArchiveStaffResult =>
    msg === 'last_staff' || msg === 'has_bookings' ? { ok: false, reason: msg } : { ok: false, reason: 'error' };
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/staff/${staffId}`, { method: 'DELETE' });
    if (res.ok) return { ok: true };
    const err = (await res.json().catch(() => ({}) as { error?: string })).error ?? '';
    return asReason(err);
  }
  await localWrite();
  try {
    store.archiveStaff(shopId, staffId);
    // Push BEFORE returning — this used to sit after the return, so archiving
    // a stylist never reached the salon's other devices and they stayed
    // bookable there until some unrelated config write happened to sync.
    syncConfig(shopId);
    return { ok: true };
  } catch (e) {
    // last team member, or upcoming appointments still on their book —
    // refuse rather than empty the calendar or strand customers
    return asReason(e instanceof Error ? e.message : '');
  }
}

export async function apiLocations(shopId: string): Promise<ShopLocation[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/locations`);
    return res.ok ? (await res.json()).locations : [];
  }
  await readyForRead();
  return store.shopLocations(shopId);
}

export async function apiAddLocation(shopId: string, input: Omit<ShopLocation, 'id'>): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/locations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return;
  }
  await localWrite();
  store.addLocation(shopId, input);
  syncConfig(shopId);
}

export async function apiPatchLocation(shopId: string, locationId: string, patch: Partial<ShopLocation>): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/locations/${locationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return;
  }
  await localWrite();
  store.patchLocation(shopId, locationId, patch);
  syncConfig(shopId);
}

export async function apiDeleteLocation(shopId: string, locationId: string): Promise<boolean> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/locations/${locationId}`, { method: 'DELETE' });
    return res.ok;
  }
  await localWrite();
  try {
    store.deleteLocation(shopId, locationId);
    syncConfig(shopId);
    return true;
  } catch {
    return false;
  }
}

// ---- HR --------------------------------------------------------------------

export async function apiHrOverview(shopId: string, from: string, to: string): Promise<HrRow[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/hr?from=${from}&to=${to}`);
    return res.ok ? (await res.json()).rows : [];
  }
  await readyForRead();
  return store.hrOverview(shopId, from, to);
}

// ---- reviews & waitlist (shop side) ---------------------------------------

export async function apiShopReviewsForOwner(shopId: string): Promise<ShopReview[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/reviews`);
    return res.ok ? (await res.json()).reviews : [];
  }
  await readyForRead();
  return store.shopReviews(shopId);
}

export async function apiReplyToReview(shopId: string, bookingId: string, text: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingId, text }),
    });
    return;
  }
  await readyForWrite();
  store.setReviewReply(shopId, bookingId, text);
}

export async function apiWaitlistOffer(
  shopId: string,
  entryId: string,
  startsAt: number,
): Promise<{ ok: boolean; code?: 'slot_gone' }> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/waitlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryId, startsAt }),
    });
    if (res.ok) return { ok: true };
    return { ok: false, code: res.status === 409 ? 'slot_gone' : undefined };
  }
  await localWrite();
  try {
    store.offerWaitlistSlot(shopId, entryId, startsAt);
    announceMessages();
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e instanceof Error && e.message === 'slot_gone' ? 'slot_gone' : undefined };
  }
}

export async function apiShopWaitlist(shopId: string, from: string): Promise<ShopWaitlistRow[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/waitlist?from=${from}`);
    return res.ok ? (await res.json()).waiting : [];
  }
  await readyForRead();
  return store.waitlistForShop(shopId, from);
}

// ---- customers ------------------------------------------------------------

export async function apiShopCustomers(shopId: string): Promise<CustomerRow[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/customers`);
    return res.ok ? (await res.json()).customers : [];
  }
  await readyForRead();
  return store.customersForShop(shopId);
}

export async function apiSetCustomerNote(shopId: string, key: string, note: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/customers`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, note }),
    });
    return;
  }
  await localWrite();
  store.setCustomerNote(shopId, key, note);
  syncConfig(shopId);
}

// ---- shop closures --------------------------------------------------------

export async function apiClosures(shopId: string): Promise<ShopClosure[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/closures`);
    return res.ok ? (await res.json()).closures : [];
  }
  await readyForRead();
  return store.shopClosures(shopId);
}

export async function apiAddClosure(
  shopId: string,
  input: { from: string; to: string; reason: string },
): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/closures`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return;
  }
  await localWrite();
  store.addClosure(shopId, input);
  syncConfig(shopId);
}

export async function apiDeleteClosure(shopId: string, closureId: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/closures/${closureId}`, { method: 'DELETE' });
    return;
  }
  await localWrite();
  store.deleteClosure(shopId, closureId);
  syncConfig(shopId);
}

export async function apiShopCalendar(shopId: string, from: string, to: string): Promise<CalendarDay[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/calendar?from=${from}&to=${to}`);
    return res.ok ? (await res.json()).days : [];
  }
  await readyForRead();
  return store.shopCalendar(shopId, from, to);
}

export async function apiRevenueReport(shopId: string, from: string, to: string): Promise<RevenueReport | null> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/revenue?from=${from}&to=${to}`);
    return res.ok ? await res.json() : null;
  }
  await readyForRead();
  return store.revenueReport(shopId, from, to);
}

export async function apiBookingLedger(shopId: string, from: string, to: string): Promise<store.LedgerRow[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/reports?view=ledger&from=${from}&to=${to}`))?.data ?? [];
  }
  await readyForRead();
  return store.bookingLedger(shopId, from, to);
}

export async function apiDayClose(shopId: string, iso: string): Promise<DayCloseReport | null> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/revenue?close=${iso}`);
    return res.ok ? await res.json() : null;
  }
  await readyForRead();
  return store.dayCloseReport(shopId, iso);
}

export async function apiRoster(shopId: string, from: string, to: string): Promise<RosterCalendar | null> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/roster?from=${from}&to=${to}`);
    return res.ok ? await res.json() : null;
  }
  await readyForRead();
  return store.rosterCalendar(shopId, from, to);
}

export async function apiAddAbsence(
  shopId: string,
  staffId: string,
  input: { from: string; to: string; kind: AbsenceKind; note?: string },
): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/staff/${staffId}/absences`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return;
  }
  await localWrite();
  store.addAbsence(staffId, input);
  syncConfig(shopId);
}

export async function apiRequestAbsence(
  shopId: string,
  staffId: string,
  input: { from: string; to: string; kind: AbsenceKind; note?: string },
): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/staff/${staffId}/absences`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, asRequest: true }),
    });
    announceMessages();
    return;
  }
  await localWrite();
  store.requestAbsence(staffId, input);
  syncConfig(shopId);
  announceMessages();
}

export async function apiApproveAbsence(shopId: string, staffId: string, absenceId: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/staff/${staffId}/absences`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ absenceId }),
    });
    announceMessages();
    return;
  }
  await localWrite();
  store.approveAbsence(staffId, absenceId);
  syncConfig(shopId);
  announceMessages();
}

export async function apiStaffAbsences(shopId: string, staffId: string): Promise<Absence[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/staff/${staffId}/absences`);
    return res.ok ? (await res.json()).absences : [];
  }
  await readyForRead();
  return store.absencesFor(staffId);
}

export async function apiDeleteAbsence(shopId: string, staffId: string, absenceId: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/staff/${staffId}/absences/${absenceId}`, { method: 'DELETE' });
    return;
  }
  await localWrite();
  store.deleteAbsence(staffId, absenceId);
  syncConfig(shopId);
}

export type { ApiSlot, HrRow, RosterCalendar, CalendarDay, RevenueReport, CustomerRow, ShopReview, ShopWaitlistRow, ShopClosure, Absence, AbsenceKind, ShopPhoto, Message, ThreadSummary, StaffWeekDayView, AppNotice, BillingProfile, BookingConflict, DayCloseReport, GiftCard };

/**
 * The bookings a personnel decision would strand — see store.bookingConflicts.
 * Pass a staffId for a per-stylist question (time off, archiving), or null for
 * a shop-wide one (closure). from/to are inclusive ISO dates.
 */
export async function apiBookingConflicts(
  shopId: string,
  staffId: string | null,
  from?: string,
  to?: string,
): Promise<BookingConflict[]> {
  if (backendMode() === 'server') {
    const params = new URLSearchParams();
    if (staffId) params.set('staff', staffId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const res = await fetch(`/api/shop/${shopId}/conflicts?${params}`);
    return res.ok ? (await res.json()).conflicts : [];
  }
  await readyForRead();
  return store.bookingConflicts(shopId, { staffId, fromIso: from, toIso: to });
}

// ---- discovery batch: flexible saver, add-ons, insights, nearby -----------

export async function apiCheapestSlots(
  shopId: string,
  serviceIds: string[],
): Promise<store.SaverSlot[]> {
  if (backendMode() === 'server') {
    return (await postJson(`/api/shop/${shopId}/discovery`, { view: 'cheapest', serviceIds, deviceId: deviceId() }))?.data ?? [];
  }
  await readyForRead();
  return store.cheapestSlots(shopId, serviceIds, deviceId());
}

export async function apiSuggestedAddOns(
  shopId: string,
  serviceIds: string[],
): Promise<ReturnType<typeof store.suggestedAddOns>> {
  if (backendMode() === 'server') {
    return (await postJson(`/api/shop/${shopId}/discovery`, { view: 'add-ons', serviceIds, deviceId: deviceId() }))?.data ?? [];
  }
  await readyForRead();
  return store.suggestedAddOns(shopId, serviceIds);
}

export async function apiStaffInsights(
  shopId: string,
  serviceIds: string[],
): Promise<Record<string, store.StaffInsight>> {
  if (backendMode() === 'server') {
    return (await postJson(`/api/shop/${shopId}/discovery`, { view: 'insights', serviceIds, deviceId: deviceId() }))?.data ?? {};
  }
  await readyForRead();
  return store.staffInsights(shopId, serviceIds, deviceId());
}

export async function apiAlternativesFor(
  shopId: string,
  serviceIds: string[],
  isoDate: string,
): Promise<store.NearbyAlternative[]> {
  if (backendMode() === 'server') {
    return (await postJson(`/api/shop/${shopId}/discovery`, { view: 'alternatives', serviceIds, isoDate, deviceId: deviceId() }))?.data ?? [];
  }
  await readyForRead();
  return store.alternativesFor(shopId, serviceIds, isoDate, deviceId());
}

export async function apiQuietDiscount(shopId: string): Promise<number> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/settings`))?.quietDiscount ?? 0;
  }
  await readyForRead();
  return store.quietDiscountOf(shopId);
}

export async function apiSetQuietDiscount(shopId: string, pct: number): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/settings`, { quietDiscount: pct }, 'PATCH'));
    return;
  }
  await localWrite();
  store.setQuietDiscount(shopId, pct);
  syncConfig(shopId);
}

// ---- customer lifecycle batch: rhythm, people, recap, privacy, goodwill ----

export async function apiRebookCadence(): Promise<store.DueRebook[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/me/lifecycle?view=rebook&deviceId=${encodeURIComponent(deviceId())}`))?.data ?? [];
  }
  await readyForRead();
  return store.rebookCadence(deviceId());
}

export async function apiSavedPeople(): Promise<store.SavedPerson[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/me/people?deviceId=${encodeURIComponent(deviceId())}`))?.people ?? [];
  }
  await readyForRead();
  return store.savedPeople(deviceId());
}

export async function apiAddPerson(input: { name: string; emoji?: string; note?: string }): Promise<store.SavedPerson> {
  if (backendMode() === 'server') {
    return (await okJson(await post('/api/me/people', { ...input, deviceId: deviceId() }))).person;
  }
  await localWrite();
  return store.addPerson(deviceId(), input);
}

export async function apiRemovePerson(personId: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await fetch(`/api/me/people?deviceId=${encodeURIComponent(deviceId())}&personId=${encodeURIComponent(personId)}`, { method: 'DELETE' }));
    return;
  }
  await localWrite();
  store.removePerson(deviceId(), personId);
}

export async function apiCustomerRecap(year: number): Promise<store.YearRecap> {
  if (backendMode() === 'server') {
    const r = (await getJson(`/api/me/lifecycle?view=recap&year=${year}&deviceId=${encodeURIComponent(deviceId())}`))?.data;
    if (r) return r;
  }
  await readyForRead();
  return store.customerRecap(deviceId(), year);
}

export async function apiExportMyData(): Promise<Record<string, unknown>> {
  if (backendMode() === 'server') {
    return (await okJson(await fetch(`/api/me/lifecycle?view=export&deviceId=${encodeURIComponent(deviceId())}`))).data;
  }
  await readyForRead();
  return store.exportMyData(deviceId());
}

export async function apiEraseMyData(): Promise<number> {
  if (backendMode() === 'server') {
    const { erased } = await okJson(await fetch(`/api/me/lifecycle?deviceId=${encodeURIComponent(deviceId())}`, { method: 'DELETE' }));
    store.eraseMyData(deviceId()); // and this browser's own mirror (saved people, notes)
    return erased;
  }
  await localWrite();
  const n = store.eraseMyData(deviceId());
  // Erasure that only scrubs the local mirror would resurrect on the next
  // sync — push every touched booking to the source of truth as well.
  if (backendMode() === 'supabase') {
    for (const b of store.bookingsForDevice(deviceId())) {
      await sb.pushBooking(b).catch(() => {});
    }
  }
  return n;
}

// ---- shop-floor batch: check-in, walk-ins, logbook, checklists, tech cards -

export async function apiCheckIn(bookingId: string): Promise<boolean> {
  if (backendMode() === 'server') {
    const res = await post(`/api/bookings/${bookingId}/check-in`, { deviceId: deviceId() });
    return res.ok;
  }
  await localWrite();
  try {
    const b = store.checkIn(bookingId, deviceId());
    // the whole point is that the SHOP's device sees the arrival
    if (backendMode() === 'supabase') await sb.pushBooking(b).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export async function apiWalkIns(shopId: string): Promise<store.WalkInEntry[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/walkins`).catch(() => null);
    return res?.ok ? (await res.json()).walkIns : [];
  }
  await readyForRead();
  return store.walkIns(shopId);
}

export async function apiAddWalkIn(shopId: string, name: string, serviceIds: string[]): Promise<store.WalkInEntry> {
  if (backendMode() === 'server') {
    const res = await post(`/api/shop/${shopId}/walkins`, { name, serviceIds });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'error');
    return body.entry;
  }
  await localWrite();
  return store.addWalkIn(shopId, name, serviceIds);
}

export async function apiSetWalkInState(shopId: string, id: string, next: store.WalkInEntry['state']): Promise<void> {
  if (backendMode() === 'server') {
    const res = await post(`/api/shop/${shopId}/walkins/${id}`, { state: next }, 'PATCH');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'error');
    return;
  }
  await localWrite();
  store.setWalkInState(shopId, id, next);
}

export async function apiRemoveWalkIn(shopId: string, id: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/walkins/${id}`, { method: 'DELETE' });
    return;
  }
  await localWrite();
  store.removeWalkIn(shopId, id);
}

export async function apiConvertWalkIn(shopId: string, id: string): Promise<{ ok: boolean; reference?: string }> {
  if (backendMode() === 'server') {
    const res = await post(`/api/shop/${shopId}/walkins/${id}/convert`, {});
    return res.ok ? { ok: true, reference: (await res.json()).reference } : { ok: false };
  }
  await localWrite();
  try {
    const b = store.convertWalkIn(shopId, id);
    return { ok: true, reference: b.reference };
  } catch {
    return { ok: false };
  }
}

export async function apiEstimatedWait(shopId: string): Promise<number | null> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/public`))?.waitMin ?? null;
  }
  await readyForRead();
  return store.estimatedWaitMin(shopId);
}

export async function apiLogEntries(shopId: string): Promise<store.LogEntry[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/logbook`))?.entries ?? [];
  }
  await readyForRead();
  return store.logEntries(shopId);
}

export async function apiAddLogEntry(shopId: string, authorStaffId: string, text: string, pinned?: boolean): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/logbook`, { authorStaffId, text, pinned }));
    return;
  }
  await localWrite();
  store.addLogEntry(shopId, authorStaffId, text, pinned);
  syncConfig(shopId);
}

export async function apiAckLogEntry(shopId: string, entryId: string, staffId: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/logbook`, { entryId, staffId }, 'PATCH'));
    return;
  }
  await localWrite();
  store.ackLogEntry(shopId, entryId, staffId);
  syncConfig(shopId);
}

export async function apiDeleteLogEntry(shopId: string, entryId: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await fetch(`/api/shop/${shopId}/logbook?entryId=${encodeURIComponent(entryId)}`, { method: 'DELETE' }));
    return;
  }
  await localWrite();
  store.deleteLogEntry(shopId, entryId);
  syncConfig(shopId);
}

export async function apiChecklists(shopId: string): Promise<store.ChecklistTemplate[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/checklists`))?.checklists ?? [];
  }
  await readyForRead();
  return store.checklists(shopId);
}

export async function apiSaveChecklist(
  shopId: string,
  tpl: Omit<store.ChecklistTemplate, 'id'> & { id?: string },
): Promise<store.ChecklistTemplate> {
  if (backendMode() === 'server') {
    return (await okJson(await post(`/api/shop/${shopId}/checklists`, { template: tpl }))).checklist;
  }
  await localWrite();
  const saved = store.saveChecklist(shopId, tpl);
  syncConfig(shopId);
  return saved;
}

export async function apiDeleteChecklist(shopId: string, id: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await fetch(`/api/shop/${shopId}/checklists?checklistId=${encodeURIComponent(id)}`, { method: 'DELETE' }));
    return;
  }
  await localWrite();
  store.deleteChecklist(shopId, id);
  syncConfig(shopId);
}

export async function apiChecklistCompletion(
  shopId: string,
  iso: string,
): Promise<ReturnType<typeof store.checklistCompletion>> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/checklists?iso=${iso}`))?.completion ?? [];
  }
  await readyForRead();
  return store.checklistCompletion(shopId, iso);
}

export async function apiChecklistTicks(shopId: string, iso: string): Promise<store.ChecklistTick[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/checklists?iso=${iso}`))?.ticks ?? [];
  }
  await readyForRead();
  return store.checklistTicks(shopId, iso);
}

export async function apiTickChecklistItem(shopId: string, iso: string, itemId: string, staffId: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/checklists`, { iso, itemId, staffId }, 'PATCH'));
    return;
  }
  await localWrite();
  store.tickChecklistItem(shopId, iso, itemId, staffId);
  syncConfig(shopId);
}

export async function apiSetTechRecord(
  shopId: string,
  bookingId: string,
  rec: { formula: string; developer?: string; processingMin?: number; note?: string; byStaffId: string },
): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/tech-records`, { bookingId, record: rec }));
    return;
  }
  await localWrite();
  const b = store.setTechRecord(shopId, bookingId, rec);
  // a formula card only helps if the tablet at the backwash sees it too
  if (backendMode() === 'supabase') await sb.pushBooking(b).catch(() => {});
}

export async function apiLatestTechRecord(
  shopId: string,
  customerKey: string,
): Promise<ReturnType<typeof store.latestTechRecord>> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/tech-records?customerKey=${encodeURIComponent(customerKey)}`))?.latest ?? null;
  }
  await readyForRead();
  return store.latestTechRecord(shopId, customerKey);
}

export async function apiPublicQueue(shopId: string): Promise<{ queued: number; waitMin: number | null }> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/public`))?.queue ?? { queued: 0, waitMin: null };
  }
  await readyForRead();
  return store.publicQueue(shopId);
}

// ---- records & reports batch: Kassenbuch, commission, utilization, tags, care

export async function apiCashEntries(shopId: string, iso: string): Promise<store.CashEntry[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/cash?iso=${iso}`))?.entries ?? [];
  }
  await readyForRead();
  return store.cashEntries(shopId, iso);
}

export async function apiAddCashEntry(
  shopId: string,
  iso: string,
  input: { kind: store.CashEntry['kind']; amountCents: number; note?: string },
): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/cash`, { iso, ...input }));
    return;
  }
  await localWrite();
  store.addCashEntry(shopId, iso, input);
  syncConfig(shopId);
}

export async function apiDeleteCashEntry(shopId: string, iso: string, id: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await fetch(`/api/shop/${shopId}/cash?iso=${iso}&entryId=${encodeURIComponent(id)}`, { method: 'DELETE' }));
    return;
  }
  await localWrite();
  store.deleteCashEntry(shopId, iso, id);
  syncConfig(shopId);
}

export async function apiDrawerReport(shopId: string, iso: string): Promise<store.DrawerReport> {
  if (backendMode() === 'server') {
    return (await okJson(await fetch(`/api/shop/${shopId}/cash?iso=${iso}`))).report;
  }
  await readyForRead();
  return store.drawerReport(shopId, iso);
}

export async function apiStaffEarnings(shopId: string, fromIso: string, toIso: string): Promise<store.StaffEarningsRow[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/reports?view=staff-earnings&from=${fromIso}&to=${toIso}`))?.data ?? [];
  }
  await readyForRead();
  return store.staffEarningsReport(shopId, fromIso, toIso);
}

export async function apiUtilizationReport(shopId: string, fromIso: string, toIso: string): Promise<store.UtilizationReport> {
  if (backendMode() === 'server') {
    const r = (await getJson(`/api/shop/${shopId}/reports?view=utilization&from=${fromIso}&to=${toIso}`))?.data;
    if (r) return r;
  }
  await readyForRead();
  return store.utilizationReport(shopId, fromIso, toIso);
}

export async function apiReviewTagStats(shopId: string): Promise<ReturnType<typeof store.reviewTagStats>> {
  if (backendMode() === 'server') {
    const r = (await getJson(`/api/shop/${shopId}/reports?view=review-tags`))?.data;
    if (r) return r;
  }
  await readyForRead();
  return store.reviewTagStats(shopId);
}

export async function apiCareProfile(): Promise<store.CareProfile> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/me/care?deviceId=${encodeURIComponent(deviceId())}`))?.profile ?? { allergies: [], patchTests: [] };
  }
  await readyForRead();
  return store.careProfile(deviceId());
}

export async function apiSetAllergies(allergies: string[]): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post('/api/me/care', { allergies, deviceId: deviceId() }, 'PATCH'));
    return;
  }
  await localWrite();
  store.setAllergies(deviceId(), allergies);
}

export async function apiRecordPatchTest(shopId: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post('/api/me/care', { shopId, deviceId: deviceId() }));
    return;
  }
  await localWrite();
  store.recordPatchTest(deviceId(), shopId);
}

export async function apiPatchTestValid(shopId: string): Promise<boolean> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/me/care?deviceId=${encodeURIComponent(deviceId())}&shopId=${encodeURIComponent(shopId)}`))?.patchTestValid ?? false;
  }
  await readyForRead();
  return store.patchTestValid(deviceId(), shopId);
}

// ---- scheduling core batch: resources, gaps, drift, consultation-first ----

export async function apiResources(shopId: string): Promise<store.ShopResources | null> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/settings`))?.resources ?? null;
  }
  await readyForRead();
  return store.resourcesOf(shopId);
}

export async function apiSetResources(shopId: string, res: store.ShopResources): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/settings`, { resources: res }, 'PATCH'));
    return;
  }
  await localWrite();
  store.setResources(shopId, res);
  syncConfig(shopId);
}

export async function apiGapWindows(shopId: string, iso: string): Promise<store.GapWindow[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/reports?view=gaps&iso=${iso}`))?.data ?? [];
  }
  await readyForRead();
  return store.gapWindows(shopId, iso);
}

export async function apiDayDrift(shopId: string): Promise<number> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/reports?view=drift`))?.data ?? 0;
  }
  await readyForRead();
  return store.dayDriftMin(shopId);
}

export async function apiEnsureConsultService(shopId: string): Promise<{ id: string }> {
  if (backendMode() === 'server') {
    return (await okJson(await post(`/api/shop/${shopId}/consult`, {}))).service;
  }
  await localWrite();
  const svc = store.ensureConsultService(shopId);
  syncConfig(shopId);
  return svc;
}

export async function apiConsultDone(shopId: string): Promise<boolean> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/consult?deviceId=${encodeURIComponent(deviceId())}`))?.done ?? false;
  }
  await readyForRead();
  return store.consultDone(deviceId(), shopId);
}

// ---- money products batch: packages, deals, treatment gifts, groups, club --

export async function apiPackageOffers(shopId: string): Promise<store.PackageOffer[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/packages`))?.offers ?? [];
  }
  await readyForRead();
  return store.packageOffers(shopId);
}

export async function apiSavePackageOffer(
  shopId: string,
  offer: { id?: string; serviceId: string; count: number; priceCents: number },
): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/packages`, { offer }, 'PATCH'));
    return;
  }
  await localWrite();
  store.savePackageOffer(shopId, offer);
  syncConfig(shopId);
}

export async function apiDeletePackageOffer(shopId: string, offerId: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await fetch(`/api/shop/${shopId}/packages?offerId=${encodeURIComponent(offerId)}`, { method: 'DELETE' }));
    return;
  }
  await localWrite();
  store.deletePackageOffer(shopId, offerId);
  syncConfig(shopId);
}

export async function apiBuyPackage(
  shopId: string,
  offerId: string,
  payment?: { method: store.PaymentMethod; label: string },
): Promise<store.OwnedPackage | null> {
  if (backendMode() === 'server') {
    const res = await post(`/api/shop/${shopId}/packages`, { offerId, payment, deviceId: deviceId() });
    return res.ok ? (await res.json()).pkg : null;
  }
  await localWrite();
  try {
    return store.buyPackage(shopId, offerId, deviceId(), payment);
  } catch {
    return null;
  }
}

export async function apiMyPackages(): Promise<ReturnType<typeof store.myPackages>> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/me/packages?deviceId=${encodeURIComponent(deviceId())}`))?.packages ?? [];
  }
  await readyForRead();
  return store.myPackages(deviceId());
}

export async function apiPackagesForShop(shopId: string): Promise<ReturnType<typeof store.packagesForShop>> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/packages`))?.stats ?? { soldCount: 0, outstandingUses: 0, outstandingCents: 0 };
  }
  await readyForRead();
  return store.packagesForShop(shopId);
}

export async function apiLastMinuteDeals(): Promise<store.Deal[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/me/lifecycle?view=deals&deviceId=${encodeURIComponent(deviceId())}`))?.data ?? [];
  }
  await readyForRead();
  return store.lastMinuteDeals(deviceId());
}

export async function apiGiftTreatment(
  shopId: string,
  serviceId: string,
  opts: { toName?: string; fromName?: string; message?: string },
  payment?: { method: store.PaymentMethod; label: string },
): Promise<store.GiftCard | null> {
  if (backendMode() === 'server') {
    const res = await post(`/api/shop/${shopId}/gift-treatment`, { serviceId, ...opts, payment, deviceId: deviceId() });
    return res.ok ? (await res.json()).card : null;
  }
  await localWrite();
  try {
    return store.giftTreatment(shopId, deviceId(), serviceId, opts, payment);
  } catch {
    return null;
  }
}

export type GroupHoldOutcome =
  | { ok: true; holds: HoldResult[] }
  | { ok: false; code: 'slot_taken'; alternatives: ApiSlot[] }
  | { ok: false; code: 'consent_required' }
  | { ok: false; code: 'error' };

/** Three or more chairs, the same minute, one act — see store.createGroupHold. */
export async function apiGroupHold(
  input: Omit<store.HoldInput, 'idempotencyKey' | 'deviceId'>,
  friendNames: string[],
): Promise<GroupHoldOutcome> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch('/api/bookings/hold-group', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': newIdempotencyKey() },
      body: JSON.stringify({ ...input, friendNames, deviceId: deviceId() }),
    });
    if (res.status === 409) return { ok: false, code: 'slot_taken', alternatives: (await res.json()).alternatives ?? [] };
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.error === 'duo_consent_required') return { ok: false, code: 'consent_required' };
      return { ok: false, code: 'error' };
    }
    const d = await res.json();
    return { ok: true, holds: d.holds };
  }
  await ready();
  const full: store.HoldInput = { ...input, deviceId: deviceId(), idempotencyKey: newIdempotencyKey() };
  try {
    const holds =
      backendMode() === 'supabase'
        ? await sb.createGroupHold(full, friendNames)
        : store.createGroupHold(full, friendNames);
    return { ok: true, holds };
  } catch (e) {
    if (e instanceof store.SlotTaken) return { ok: false, code: 'slot_taken', alternatives: e.alternatives };
    if (e instanceof Error && e.message === 'duo_consent_required') return { ok: false, code: 'consent_required' };
    return { ok: false, code: 'error' };
  }
}

export async function apiMembershipOffer(shopId: string): Promise<store.MembershipOffer | null> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/settings`))?.membershipOffer ?? null;
  }
  await readyForRead();
  return store.membershipOffer(shopId);
}

export async function apiSetMembershipOffer(shopId: string, offer: store.MembershipOffer | null): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/settings`, { membershipOffer: offer }, 'PATCH'));
    return;
  }
  await localWrite();
  store.setMembershipOffer(shopId, offer);
  syncConfig(shopId);
}

export async function apiMyMembership(shopId: string): Promise<store.Membership | null> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/membership?deviceId=${encodeURIComponent(deviceId())}`).catch(() => null);
    return res?.ok ? (await res.json()).membership : null;
  }
  await readyForRead();
  return store.myMembership(deviceId(), shopId);
}

export async function apiJoinMembership(shopId: string): Promise<store.Membership | null> {
  if (backendMode() === 'server') {
    const res = await post(`/api/shop/${shopId}/membership`, { deviceId: deviceId() });
    return res.ok ? (await res.json()).membership : null;
  }
  await localWrite();
  try {
    return store.joinMembership(deviceId(), shopId);
  } catch {
    return null;
  }
}

export async function apiLeaveMembership(shopId: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/membership?deviceId=${encodeURIComponent(deviceId())}`, { method: 'DELETE' });
    return;
  }
  await localWrite();
  store.leaveMembership(deviceId(), shopId);
}

export async function apiMembersOfShop(shopId: string): Promise<number> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/public`))?.members ?? 0;
  }
  await readyForRead();
  return store.membersOfShop(shopId);
}

// ---- care & safety batch: birthday, access, minors, journal ---------------

export async function apiSetBirthday(mmdd: string | null): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post('/api/me/care', { birthday: mmdd, deviceId: deviceId() }, 'PATCH'));
    return;
  }
  await localWrite();
  store.setBirthday(deviceId(), mmdd);
}

export async function apiSetAccessNeeds(access: store.AccessNeeds | null): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post('/api/me/care', { access, deviceId: deviceId() }, 'PATCH'));
    return;
  }
  await localWrite();
  store.setAccessNeeds(deviceId(), access);
}

export async function apiAccessFacts(shopId: string): Promise<store.AccessFacts | null> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/perks`))?.accessFacts ?? null;
  }
  await readyForRead();
  return store.accessFactsOf(shopId);
}

export async function apiSetAccessFacts(shopId: string, facts: store.AccessFacts | null): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/perks`, { accessFacts: facts }, 'PATCH'));
    return;
  }
  await localWrite();
  store.setAccessFacts(shopId, facts);
  syncConfig(shopId);
}

export async function apiBirthdayPerk(shopId: string): Promise<number> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/perks`))?.birthdayPerk ?? 0;
  }
  await readyForRead();
  return store.birthdayPerkOf(shopId);
}

export async function apiSetBirthdayPerk(shopId: string, pct: number): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/perks`, { birthdayPerk: pct }, 'PATCH'));
    return;
  }
  await localWrite();
  store.setBirthdayPerk(shopId, pct);
  syncConfig(shopId);
}

export async function apiSetWouldRepeat(bookingId: string, on: boolean): Promise<boolean> {
  if (backendMode() === 'server') {
    const res = await post(`/api/bookings/${bookingId}/would-repeat`, { on, deviceId: deviceId() });
    return res.ok;
  }
  await localWrite();
  try {
    const b = store.setWouldRepeat(bookingId, deviceId(), on);
    if (backendMode() === 'supabase') await sb.pushBooking(b).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// ---- discovery & ops batch: watches, portfolios, stock, disputes ----------

export async function apiAddWatch(
  shopId: string,
  serviceId: string,
  staffId: string | null,
  dow: number | null,
): Promise<store.AvailabilityWatch | null> {
  if (backendMode() === 'server') {
    const res = await post('/api/me/watches', { shopId, serviceId, staffId, dow, deviceId: deviceId() }).catch(() => null);
    return res?.ok ? (await res.json()).watch : null;
  }
  await localWrite();
  try {
    return store.addAvailabilityWatch(deviceId(), shopId, serviceId, staffId, dow);
  } catch {
    return null;
  }
}

export async function apiRemoveWatch(watchId: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await fetch(`/api/me/watches?deviceId=${encodeURIComponent(deviceId())}&watchId=${encodeURIComponent(watchId)}`, { method: 'DELETE' }));
    return;
  }
  await localWrite();
  store.removeAvailabilityWatch(deviceId(), watchId);
}

export async function apiMyWatches(): Promise<ReturnType<typeof store.myWatches>> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/me/watches?deviceId=${encodeURIComponent(deviceId())}`))?.watches ?? [];
  }
  await readyForRead();
  return store.myWatches(deviceId());
}

export async function apiStaffPhotos(staffId: string): Promise<store.ShopPhoto[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/staff/${encodeURIComponent(staffId)}/photos`))?.photos ?? [];
  }
  await readyForRead();
  return store.staffPhotos(staffId);
}

export async function apiAddStaffPhoto(shopId: string, staffId: string, dataUrl: string, caption?: string): Promise<boolean> {
  if (backendMode() === 'server') {
    return (await post(`/api/shop/${shopId}/staff/${encodeURIComponent(staffId)}/photos`, { dataUrl, caption })).ok;
  }
  await localWrite();
  try {
    store.addStaffPhoto(shopId, staffId, dataUrl, caption);
    syncConfig(shopId);
    return true;
  } catch {
    return false;
  }
}

export async function apiDeleteStaffPhoto(shopId: string, staffId: string, photoId: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await fetch(`/api/shop/${shopId}/staff/${encodeURIComponent(staffId)}/photos?photoId=${encodeURIComponent(photoId)}`, { method: 'DELETE' }));
    return;
  }
  await localWrite();
  store.deleteStaffPhoto(shopId, staffId, photoId);
  syncConfig(shopId);
}

export async function apiStockItems(shopId: string): Promise<store.StockItem[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/stock`))?.items ?? [];
  }
  await readyForRead();
  return store.stockItems(shopId);
}

export async function apiSaveStockItem(
  shopId: string,
  item: { id?: string; name: string; level: number; reorderAt: number; perColourUse?: number },
): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/stock`, { item }));
    return;
  }
  await localWrite();
  store.saveStockItem(shopId, item);
  syncConfig(shopId);
}

export async function apiAdjustStock(shopId: string, itemId: string, delta: number): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await post(`/api/shop/${shopId}/stock`, { itemId, delta }, 'PATCH'));
    return;
  }
  await localWrite();
  store.adjustStock(shopId, itemId, delta);
  syncConfig(shopId);
}

export async function apiDeleteStockItem(shopId: string, itemId: string): Promise<void> {
  if (backendMode() === 'server') {
    await okJson(await fetch(`/api/shop/${shopId}/stock?itemId=${encodeURIComponent(itemId)}`, { method: 'DELETE' }));
    return;
  }
  await localWrite();
  store.deleteStockItem(shopId, itemId);
  syncConfig(shopId);
}

export async function apiColourServicesThisWeek(shopId: string): Promise<number> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/reports?view=colour-week`))?.data ?? 0;
  }
  await readyForRead();
  return store.colourServicesThisWeek(shopId);
}

export async function apiOpenDispute(
  bookingId: string,
  kind: store.DisputeKind,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  if (backendMode() === 'server') {
    const res = await post(`/api/bookings/${bookingId}/dispute`, { kind, text, deviceId: deviceId() });
    if (res.ok) return { ok: true };
    return { ok: false, error: (await res.json().catch(() => ({}))).error ?? 'error' };
  }
  await localWrite();
  try {
    const d = store.openDispute(bookingId, deviceId(), kind, text);
    // Disputes travel inside the shop config doc — same pattern as customer
    // messages: the customer's device pushes so the shop's device can see it.
    syncConfig(d.shopId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function apiMyDisputes(): Promise<store.Dispute[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/me/disputes?deviceId=${encodeURIComponent(deviceId())}`))?.disputes ?? [];
  }
  await readyForRead();
  return store.myDisputes(deviceId());
}

export async function apiDisputesForShop(shopId: string): Promise<ReturnType<typeof store.disputesForShop>> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/disputes`).catch(() => null);
    return res?.ok ? (await res.json()).disputes : [];
  }
  await readyForRead();
  return store.disputesForShop(shopId);
}

export async function apiResolveDispute(
  shopId: string,
  disputeId: string,
  resolution: { kind: 'redo' | 'goodwill' | 'declined'; note?: string },
): Promise<void> {
  if (backendMode() === 'server') {
    await post(`/api/shop/${shopId}/disputes/${disputeId}`, resolution).catch(() => null);
    return;
  }
  await localWrite();
  let d: store.Dispute;
  try {
    d = store.resolveDispute(shopId, disputeId, resolution);
  } catch {
    return; // unknown or foreign dispute — nothing to resolve
  }
  syncConfig(shopId);
  // Goodwill lives on the booking (b.goodwill), and bookings sync via
  // set_booking, not the config doc — without this push the customer's
  // device would never see the €5 apology.
  if (backendMode() === 'supabase') {
    const b = store.getBooking(d.bookingId);
    if (b) await sb.pushBooking(b).catch(() => {});
  }
}

/** A stylist's public metadata (today: their languages). */
export async function apiShopStaffMeta(shopId: string, staffId: string): Promise<string[]> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/reports?view=staff-meta&staffId=${encodeURIComponent(staffId)}`))?.data ?? [];
  }
  await readyForRead();
  return store.effectiveStaff(shopId).find((s) => s.id === staffId)?.languages ?? [];
}

// ---- verticals round 2: bundle, running late, quotes -----------------------

export async function apiBundleDiscount(shopId: string): Promise<number> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/bundle`);
    return res.ok ? (await res.json()).pct : 0;
  }
  await readyForRead();
  return store.bundleDiscountOf(shopId);
}

export async function apiSetBundleDiscount(shopId: string, pct: number): Promise<void> {
  if (backendMode() === 'server') {
    // holds are priced server-side: the percent must land there, or the
    // promotion exists only in the owner's browser
    await fetch(`/api/shop/${shopId}/bundle`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pct }),
    });
    return;
  }
  await localWrite();
  store.setBundleDiscount(shopId, pct);
  syncConfig(shopId);
}

export async function apiSetRunningLate(bookingId: string, min: number): Promise<boolean> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/bookings/${bookingId}/late`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ min, deviceId: deviceId() }),
    });
    return res.ok;
  }
  await localWrite();
  try {
    const b = store.setRunningLate(bookingId, deviceId(), min);
    // the whole point is that the FLOOR sees it, not this phone
    if (backendMode() === 'supabase') await sb.pushBooking(b).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * A quote request is the one legitimate way to message a shop you have not
 * booked yet: custom work (tattoos, bridal, concierge) starts with a
 * conversation by nature, and the shop published quotable services.
 */
export async function apiRequestQuote(shopId: string, text: string): Promise<boolean> {
  // Reuse the key this device already has at this shop — a returning
  // customer's question belongs in their existing conversation, not in a
  // second thread neither inbox can address. In server mode only the API
  // process knows the bookings, so it resolves the key there.
  if (backendMode() === 'server') {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopId, from: 'customer', text, resolveKeyForDevice: deviceId() }),
    });
    announceMessages();
    return res.ok;
  }
  await readyForRead();
  const key = store.threadKeyForDevice(shopId, deviceId());
  const msg = await apiSendMessage(shopId, key, 'customer', text);
  return Boolean(msg);
}

// ---- corporate packages ----------------------------------------------------

export async function apiBuyCorporateBatch(
  shopId: string,
  company: string,
  count: number,
  amountCents: number,
  payment?: { method: PaymentMethod; label: string },
): Promise<{ ok: true; batch: store.CorporateBatch } | { ok: false; error: string }> {
  if (backendMode() === 'server') {
    // Same door as every gift-card sibling: the codes must exist where the
    // booking checkout will validate them, not only in this browser.
    const res = await fetch(`/api/shop/${shopId}/corporate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company, count, amountCents, payment, deviceId: deviceId() }),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, batch: body.batch } : { ok: false, error: body.error ?? 'error' };
  }
  await localWrite();
  try {
    return { ok: true, batch: store.buyCorporateBatch(shopId, deviceId(), company, count, amountCents, payment) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function apiMyCorporateBatches(): Promise<store.CorporateBatch[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/me/corporate?deviceId=${encodeURIComponent(deviceId())}`);
    return res.ok ? (await res.json()).batches : [];
  }
  await readyForRead();
  return store.myCorporateBatches(deviceId());
}

export async function apiCorporateForShop(shopId: string): Promise<ReturnType<typeof store.corporateBatchesForShop> | null> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/corporate`);
    return res.ok ? await res.json() : null;
  }
  await readyForRead();
  return store.corporateBatchesForShop(shopId);
}

// ---- round 6: context, consent, retail, travel, follows -------------------

export type RefPhotoOutcome = { ok: true } | { ok: false; reason: string };

/**
 * A reason, not just a boolean — this used to return false for every kind of
 * refusal alike, so a full album and a decode failure looked identical and
 * neither could be explained to the person who just watched nothing happen.
 */
export async function apiAddRefPhoto(bookingId: string, dataUrl: string, caption = ''): Promise<RefPhotoOutcome> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/bookings/${bookingId}/ref-photos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId(), dataUrl, caption }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, reason: String(body.error ?? 'error') };
  }
  await localWrite();
  try {
    const b = store.addRefPhoto(bookingId, deviceId(), dataUrl, caption);
    // the stylist reads these on their own device, so the booking must travel
    if (backendMode() === 'supabase') await sb.pushBooking(b).catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'error' };
  }
}

export async function apiRemoveRefPhoto(bookingId: string, photoId: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(
      `/api/bookings/${bookingId}/ref-photos?deviceId=${encodeURIComponent(deviceId())}&photoId=${encodeURIComponent(photoId)}`,
      { method: 'DELETE' },
    );
    return;
  }
  await localWrite();
  try {
    const b = store.removeRefPhoto(bookingId, deviceId(), photoId);
    if (backendMode() === 'supabase') await sb.pushBooking(b).catch(() => {});
  } catch {
    // gone already
  }
}

export async function apiConsentText(shopId: string): Promise<string> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/policies`);
    return res.ok ? (await res.json()).consentText : '';
  }
  await readyForRead();
  return store.consentTextOf(shopId);
}

/** The wording this basket must have signed — '' when nothing is needed. */
export async function apiConsentRequired(shopId: string, serviceIds: string[]): Promise<string> {
  if (backendMode() === 'server') {
    const res = await fetch(
      `/api/shop/${shopId}/policies?serviceIds=${encodeURIComponent(serviceIds.join(','))}`,
    );
    return res.ok ? (await res.json()).consentRequired : '';
  }
  await readyForRead();
  return store.consentRequired(shopId, serviceIds);
}

export async function apiSetConsentText(shopId: string, text: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/policies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consentText: text }),
    });
    return;
  }
  await localWrite();
  store.setConsentText(shopId, text);
  syncConfig(shopId);
}

export async function apiArrivalNote(shopId: string): Promise<string> {
  if (backendMode() === 'server') {
    const res = await fetch(
      `/api/shop/${shopId}/policies?deviceId=${encodeURIComponent(deviceId())}`,
    );
    return res.ok ? (await res.json()).arrivalNote : '';
  }
  await readyForRead();
  return store.arrivalNoteFor(shopId, deviceId());
}

export async function apiArrivalNoteOwn(shopId: string): Promise<string> {
  if (backendMode() === 'server') {
    // Deliberately a different URL from the public policies GET — that one
    // answers the customer booking flow with no proof of anything, and the
    // door code has no business riding along in that response.
    const res = await fetch(`/api/shop/${shopId}/policies/owner`);
    return res.ok ? (await res.json()).arrivalNoteOwn : '';
  }
  await readyForRead();
  return store.arrivalNoteOf(shopId);
}

export async function apiSetArrivalNote(shopId: string, note: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/policies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ arrivalNote: note }),
    });
    return;
  }
  await localWrite();
  store.setArrivalNote(shopId, note);
  syncConfig(shopId);
}

export async function apiRetailItems(shopId: string): Promise<store.RetailItem[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/retail`);
    return res.ok ? (await res.json()).items : [];
  }
  await readyForRead();
  return store.retailItems(shopId);
}

export async function apiSaveRetailItem(
  shopId: string,
  item: { id?: string; name: string; priceCents: number; stockItemId?: string },
): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/retail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(item),
    });
    return;
  }
  await localWrite();
  store.saveRetailItem(shopId, item);
  syncConfig(shopId);
}

export async function apiDeleteRetailItem(shopId: string, itemId: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/retail/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
    return;
  }
  await localWrite();
  store.deleteRetailItem(shopId, itemId);
  syncConfig(shopId);
}

export type RetailLine = NonNullable<store.Booking['retail']>[number];
export type RetailOutcome = { ok: true; retail: RetailLine[]; totalCents: number } | { ok: false };

/**
 * Both add and remove hand back the booking's live retail lines, not just a
 * boolean. The dialog that calls these renders from a snapshot captured when
 * it was opened — reloading the shop's overview never re-derives that
 * snapshot, so without a live answer here a sale could look like it never
 * happened and get sold again from the same stale list.
 */
export async function apiAddRetail(shopId: string, bookingId: string, itemId: string, qty = 1): Promise<RetailOutcome> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/bookings/${bookingId}/retail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemId, qty }),
    });
    if (!res.ok) return { ok: false };
    const d = await res.json();
    return { ok: true, retail: d.retail, totalCents: d.totalCents };
  }
  await localWrite();
  try {
    const b = store.addRetail(shopId, bookingId, itemId, qty);
    if (backendMode() === 'supabase') await sb.pushBooking(b).catch(() => {});
    syncConfig(shopId); // the shelf count moved too
    return { ok: true, retail: b.retail ?? [], totalCents: b.quote.totalCents };
  } catch {
    return { ok: false };
  }
}

export async function apiRemoveRetail(shopId: string, bookingId: string, index: number): Promise<RetailOutcome> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/bookings/${bookingId}/retail?index=${index}`, { method: 'DELETE' });
    if (!res.ok) return { ok: false };
    const d = await res.json();
    return { ok: true, retail: d.retail, totalCents: d.totalCents };
  }
  await localWrite();
  try {
    const b = store.removeRetail(shopId, bookingId, index);
    if (backendMode() === 'supabase') await sb.pushBooking(b).catch(() => {});
    syncConfig(shopId);
    return { ok: true, retail: b.retail ?? [], totalCents: b.quote.totalCents };
  } catch {
    return { ok: false };
  }
}

export async function apiCancelReasonStats(shopId: string): Promise<ReturnType<typeof store.cancelReasonStats>> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/cancel-reasons`);
    return res.ok ? (await res.json()).rows : [];
  }
  await readyForRead();
  return store.cancelReasonStats(shopId);
}

export async function apiToggleFollow(staffId: string): Promise<boolean> {
  await localWrite();
  return store.toggleFollowStaff(deviceId(), staffId);
}

export async function apiFollowedStaff(): Promise<string[]> {
  await readyForRead();
  return store.followedStaff(deviceId());
}

export async function apiFollowedOpenings(): Promise<ReturnType<typeof store.followedOpenings>> {
  if (backendMode() === 'server') {
    // followedStaff is a browser-local preference (see apiFollowedStaff) —
    // resolve it here and send the list to the server, which is where the
    // real bookings live in this mode.
    const staffIds = store.followedStaff(deviceId());
    if (staffIds.length === 0) return [];
    const res = await fetch('/api/staff/openings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staffIds, deviceId: deviceId() }),
    });
    return res.ok ? (await res.json()).rows : [];
  }
  await readyForRead();
  return store.followedOpenings(deviceId());
}

export async function apiEarliestAcross(shopIds: string[]): Promise<ReturnType<typeof store.earliestAcross>> {
  if (backendMode() === 'server') {
    const res = await fetch('/api/shops/earliest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopIds, deviceId: deviceId() }),
    });
    return res.ok ? (await res.json()).rows : [];
  }
  await readyForRead();
  return store.earliestAcross(shopIds, deviceId());
}

export async function apiLeaveBy(
  shopId: string,
  startsAt: number,
  mode: store.TravelMode,
): Promise<ReturnType<typeof store.leaveBy>> {
  if (backendMode() === 'server') {
    return (await getJson(`/api/shop/${shopId}/reports?view=leave-by&startsAt=${startsAt}&mode=${mode}`))?.data ?? null;
  }
  await readyForRead();
  return store.leaveBy(shopId, startsAt, mode);
}

// ---- shop refs (salons registered after the build) -------------------------

export async function apiShopRefs(ids: string[]): Promise<Array<{ id: string; name: string; emoji: string }>> {
  if (ids.length === 0) return [];
  if (backendMode() === 'server') {
    return (await getJson(`/api/shops/refs?ids=${ids.map(encodeURIComponent).join(',')}`))?.shops ?? [];
  }
  await readyForRead();
  return ids.flatMap((id) => {
    const s = store.shopById(id);
    return s ? [{ id: s.id, name: s.name, emoji: s.emoji }] : [];
  });
}

// ---- platform admin -------------------------------------------------------
//
// Server mode: every call carries the key the admin typed on /admin, held in
// sessionStorage only (gone when the tab closes), as `x-admin-key`; the routes
// compare it with STYLENOW_ADMIN_KEY. Local/static mode (and the Supabase
// mirror) runs the engine in this browser — there is no server to protect
// anything, so these call the store directly; it is a demo of the screen.

const ADMIN_KEY_STORE = 'stylenow.admin.key';

export function adminKey(): string {
  try {
    return window.sessionStorage.getItem(ADMIN_KEY_STORE) ?? '';
  } catch {
    return '';
  }
}

export function setAdminKey(key: string): void {
  try {
    if (key) window.sessionStorage.setItem(ADMIN_KEY_STORE, key);
    else window.sessionStorage.removeItem(ADMIN_KEY_STORE);
  } catch {
    // storage blocked — the key lives only as long as this page
  }
}

/** Whether the admin screen needs a key at all (only the server transport checks one). */
export function adminNeedsKey(): boolean {
  return backendMode() === 'server';
}

async function adminFetch(url: string, method = 'GET', body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { 'x-admin-key': adminKey(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return okJson(res); // throws 'unauthorized' / 'admin_not_configured' / engine codes
}

type RawOverview = ReturnType<typeof store.platformOverview>;
// liveSince/freeUntil: the first 12 months on the platform carry no commission (engine-side).
export type PlatformRow = RawOverview['rows'][number] & { slug: string; liveSince?: string; freeUntil?: string };
export interface PlatformOverview {
  rows: PlatformRow[];
  totals: RawOverview['totals'];
  breakage?: ReturnType<typeof store.voucherBreakage>;
}

export async function apiAdminApplications(): Promise<ShopApplication[]> {
  if (backendMode() === 'server') return (await adminFetch('/api/admin/applications')).applications;
  await readyForRead();
  return store.allApplications();
}

export async function apiAdminDecide(id: string, action: 'approve' | 'reject', reason?: string): Promise<ShopApplication> {
  if (backendMode() === 'server') {
    return (await adminFetch('/api/admin/applications', 'POST', { id, action, reason })).application;
  }
  await localWrite();
  return action === 'approve' ? store.approveApplication(id) : store.rejectApplication(id, reason ?? '');
}

export async function apiAdminSettings(): Promise<{ requireApproval: boolean }> {
  if (backendMode() === 'server') return (await adminFetch('/api/admin/settings')).settings;
  await readyForRead();
  return store.platformSettings();
}

export async function apiAdminSetRequireApproval(on: boolean): Promise<{ requireApproval: boolean }> {
  if (backendMode() === 'server') {
    return (await adminFetch('/api/admin/settings', 'PATCH', { requireApproval: on })).settings;
  }
  await localWrite();
  store.setRequireApproval(on);
  return store.platformSettings();
}

export async function apiAdminOverview(fromIso: string, toIso: string): Promise<PlatformOverview> {
  if (backendMode() === 'server') {
    return adminFetch(`/api/admin/shops?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`);
  }
  await readyForRead();
  const { rows, totals } = store.platformOverview(fromIso, toIso);
  return { rows: rows.map((r) => ({ ...r, slug: store.shopById(r.shopId)?.slug ?? '' })), totals, breakage: store.voucherBreakage() };
}

export async function apiAdminSetPaused(shopId: string, paused: boolean): Promise<void> {
  if (backendMode() === 'server') {
    await adminFetch('/api/admin/shops', 'PATCH', { shopId, paused });
    return;
  }
  await localWrite();
  store.setShopPaused(shopId, paused);
}

// ---- automatic payouts (Stripe Connect) -------------------------------------

export type PayoutNeed = 'bank' | 'person' | 'company' | 'document' | 'other';

export interface PayoutStatus {
  configured: boolean;
  connected: boolean;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  needs: PayoutNeed[];
  deadline: number | null;
  disabledReason: string | null;
  waitingCents: number;
  commissionPct: number;
  freeUntil: string;
}

/** null when there is no server (static/local) — payouts need a secret key. */
export async function apiPayoutStatus(shopId: string, ownerKey: string): Promise<PayoutStatus | null> {
  if (backendMode() !== 'server') return null;
  const res = await fetch(`/api/stripe/connect?shopId=${encodeURIComponent(shopId)}&ownerKey=${encodeURIComponent(ownerKey)}`);
  return res.ok ? await res.json() : null;
}

export interface PayoutDetailsInput {
  company?: { legalName?: string; phone?: string; vatId?: string; street?: string; zip?: string; city?: string; email?: string; smallBusiness?: boolean };
  person?: { firstName?: string; lastName?: string; dob?: string; email?: string; phone?: string; street?: string; zip?: string; city?: string };
  iban?: string;
  accountHolder?: string;
}

export async function apiSavePayoutDetails(shopId: string, ownerKey: string, input: PayoutDetailsInput): Promise<PayoutStatus | { error: string }> {
  if (backendMode() !== 'server') return { error: 'stripe_not_configured' };
  const res = await fetch('/api/stripe/connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shopId, ownerKey, ...input }),
  });
  return res.json().catch(() => ({ error: 'network' }));
}

export async function apiUploadPayoutDocument(shopId: string, ownerKey: string, file: File): Promise<PayoutStatus | { error: string }> {
  if (backendMode() !== 'server') return { error: 'stripe_not_configured' };
  const form = new FormData();
  form.set('shopId', shopId);
  form.set('ownerKey', ownerKey);
  form.set('document', file);
  const res = await fetch('/api/stripe/connect', { method: 'POST', body: form });
  return res.json().catch(() => ({ error: 'network' }));
}

// ---- company portal -----------------------------------------------------------

export async function apiCompanyStatement(): Promise<store.CompanyStatement> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/me/corporate?deviceId=${encodeURIComponent(deviceId())}&statement=1`);
    if (res.ok) return (await res.json()).statement;
    return store.companyStatement('');
  }
  await readyForRead();
  return store.companyStatement(deviceId());
}

// ---- sales leads (admin) --------------------------------------------------------

export async function apiAdminLeads(): Promise<store.Lead[]> {
  if (backendMode() === 'server') return (await adminFetch('/api/admin/leads')).leads;
  await readyForRead();
  return store.allLeads();
}

export async function apiAdminImportLeads(rows: Array<Record<string, unknown>>): Promise<{ added: number; updated: number; skipped: number }> {
  if (backendMode() === 'server') return adminFetch('/api/admin/leads', 'POST', { rows });
  await localWrite();
  return store.importLeads(rows);
}

export async function apiAdminUpdateLead(id: string, patch: { status?: store.LeadStatus; note?: string }): Promise<void> {
  if (backendMode() === 'server') {
    await adminFetch('/api/admin/leads', 'PATCH', { id, ...patch });
    return;
  }
  await localWrite();
  store.updateLead(id, patch);
}

export async function apiLeadPrefill(id: string): Promise<ReturnType<typeof store.leadPrefill>> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/leads/${encodeURIComponent(id)}`);
    return res.ok ? (await res.json()).lead : null;
  }
  await readyForRead();
  return store.leadPrefill(id);
}

/** A salon's public slug (its booking link), wherever the salon lives. */
export async function apiShopSlug(shopId: string): Promise<string | null> {
  if (backendMode() === 'server') return (await getJson(`/api/shop/${shopId}/public`))?.slug ?? null;
  await readyForRead();
  return store.shopById(shopId)?.slug ?? null;
}

// ---- staff logins (My day) ---------------------------------------------------------

export interface StaffSeat { shopId: string; staffId: string; name: string; emoji: string }

/** Salons where the signed-in person works as staff (server mode only). */
export async function apiMyStaffSeats(): Promise<StaffSeat[]> {
  if (backendMode() !== 'server') return [];
  return (await getJson('/api/me/shops'))?.staff ?? [];
}

export async function apiStaffLogins(shopId: string): Promise<store.StaffLogin[]> {
  if (backendMode() !== 'server') return [];
  return (await getJson(`/api/shop/${shopId}/staff-logins`))?.logins ?? [];
}

export async function apiGrantStaffLogin(shopId: string, email: string, staffId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/shop/${shopId}/staff-logins`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, staffId }) });
  return res.ok ? { ok: true } : { ok: false, error: (await res.json().catch(() => ({}))).error ?? 'error' };
}

export async function apiRevokeStaffLogin(shopId: string, email: string): Promise<void> {
  await fetch(`/api/shop/${shopId}/staff-logins?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
}

/** The salon's country code (decides which cash-register notice applies). */
export async function apiShopCountry(shopId: string): Promise<string> {
  if (backendMode() === 'server') return (await getJson(`/api/shop/${shopId}/public`))?.country ?? 'DE';
  await readyForRead();
  return store.shopCountry(shopId);
}
