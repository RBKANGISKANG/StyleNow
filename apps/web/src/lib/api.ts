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
} from '@/core/store';
import { todayIso } from '@/core/time';
import { deviceId, newIdempotencyKey } from '@/lib/device';
import * as sb from '@/lib/supabase-backend';

type Mode = 'server' | 'local' | 'supabase';

export function backendMode(): Mode {
  if (sb.isConfigured()) return 'supabase';
  if (process.env.NEXT_PUBLIC_BACKEND === 'local') return 'local';
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
      body: JSON.stringify({ payment }),
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

export async function apiCancel(bookingId: string, preview: boolean): Promise<CancelResult | null> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preview }),
    });
    return res.ok ? await res.json() : null;
  }
  await ready();
  try {
    const r =
      backendMode() === 'supabase'
        ? await sb.cancelBooking(bookingId, { preview, by: 'customer' })
        : store.cancelBooking(bookingId, { preview, by: 'customer' });
    return { feeCents: r.feeCents, refundCents: r.refundCents, reason: r.reason };
  } catch {
    return null;
  }
}

export async function apiMyBookings(): Promise<BookingView[]> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/me/bookings?deviceId=${encodeURIComponent(deviceId())}`);
    return (await res.json()).bookings;
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
): Promise<void> {
  const mode = backendMode();
  if (mode === 'server') {
    await fetch(`/api/shop/${shopId}/bookings/${bookingId}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    return;
  }
  await ready();
  if (backendMode() === 'supabase') await sb.setBookingStatus(shopId, bookingId, status);
  else store.setBookingStatus(shopId, bookingId, status);
}

export async function apiPatchService(
  shopId: string,
  serviceId: string,
  patch: { basePriceCents?: number; durationMin?: number; dynamicPricing?: boolean; categoryId?: string },
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

export async function apiSetReview(bookingId: string, rating: number, text: string): Promise<boolean> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch(`/api/bookings/${bookingId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating, text }),
    });
    return res.ok;
  }
  await ready();
  try {
    if (backendMode() === 'supabase') await sb.setReview(bookingId, rating, text);
    else store.setReview(bookingId, rating, text);
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
      body: JSON.stringify({ tipCents }),
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
    await fetch(`/api/waitlist/${id}`, { method: 'DELETE' });
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

export async function apiPartnerApply(data: Record<string, unknown>): Promise<ShopApplication | null> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch('/api/partner/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId(), data }),
    });
    return res.ok ? (await res.json()).application : null;
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
  return app;
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
  | { ok: false; code: 'error' };

export async function apiShopCreateBooking(
  shopId: string,
  serviceIds: string[],
  staffId: string | null,
  startsAt: number,
  guestName: string,
  contact?: { phone?: string; note?: string },
): Promise<ShopBookingOutcome> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch(`/api/shop/${shopId}/bookings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serviceIds, staffId, startsAt, guestName, ...contact }),
    });
    if (res.status === 409) return { ok: false, code: 'slot_taken', alternatives: (await res.json()).alternatives ?? [] };
    if (!res.ok) return { ok: false, code: 'error' };
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
  latest.current = fn;
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
  await readyForRead();
  return store.shopsForOwner(ownerKey);
}

export async function apiClaimShop(shopId: string, ownerKey: string): Promise<void> {
  await localWrite();
  store.claimShop(shopId, ownerKey);
  syncConfig(shopId);
}

export async function apiReleaseShop(shopId: string): Promise<void> {
  await localWrite();
  store.releaseShop(shopId);
  syncConfig(shopId);
}

/** Store the answers given before a deletion; never blocks the deletion itself. */
export async function apiRecordExitFeedback(
  kind: 'account' | 'shop',
  subject: string,
  answers: Record<string, string>,
): Promise<void> {
  try {
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

export type { ApiSlot, HrRow, RosterCalendar, CalendarDay, RevenueReport, CustomerRow, ShopReview, ShopWaitlistRow, ShopClosure, Absence, AbsenceKind, ShopPhoto, Message, ThreadSummary, StaffWeekDayView, AppNotice, BillingProfile, BookingConflict, DayCloseReport };

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
