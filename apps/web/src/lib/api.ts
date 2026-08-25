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
import * as store from '@/core/store';
import type {
  ApiSlot,
  FeedCard,
  FeedQuery,
  HoldInput,
  HoldResult,
  BookingView,
  UserReview,
  WaitlistView,
  ShopApplication,
  StaffMember,
  ShopLocation,
  HrRow,
  RevenueReport,
  Absence,
  AbsenceKind,
} from '@/core/store';
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
): Promise<ApiSlot[]> {
  if (backendMode() === 'server') {
    const params = new URLSearchParams({ shopId, serviceIds: serviceIds.join(','), date, deviceId: deviceId() });
    if (staffId) params.set('staffId', staffId);
    const res = await fetch(`/api/availability?${params}`);
    return (await res.json()).slots ?? [];
  }
  await readyForRead();
  return store.availability(shopId, serviceIds, date, deviceId(), staffId).slots;
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

export async function apiConfirm(bookingId: string): Promise<ConfirmOutcome> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch(`/api/bookings/${bookingId}/confirm`, { method: 'POST' });
    if (res.status === 410) return { ok: false, code: 'hold_expired' };
    if (!res.ok) return { ok: false, code: 'error' };
    return { ok: true, reference: (await res.json()).reference };
  }
  await ready();
  try {
    const b = backendMode() === 'supabase' ? await sb.confirmBooking(bookingId) : store.confirmBooking(bookingId);
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
  await ready();
  store.joinWaitlist(deviceId(), shopId, serviceIds, isoDate);
}

export async function apiWaitlistLeave(id: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/waitlist/${id}`, { method: 'DELETE' });
    return;
  }
  await ready();
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
  await ready();
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
): Promise<ShopBookingOutcome> {
  const mode = backendMode();
  if (mode === 'server') {
    const res = await fetch(`/api/shop/${shopId}/bookings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serviceIds, staffId, startsAt, guestName }),
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
        : store.createShopBooking(shopId, serviceIds, staffId, startsAt, guestName);
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
  await ready();
  store.claimShop(shopId, ownerKey);
}

export async function apiReleaseShop(shopId: string): Promise<void> {
  await ready();
  store.releaseShop(shopId);
}

/** Store the answers given before a deletion; never blocks the deletion itself. */
export async function apiRecordExitFeedback(
  kind: 'account' | 'shop',
  subject: string,
  answers: Record<string, string>,
): Promise<void> {
  try {
    await ready();
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
  await ready();
  store.addService(shopId, input);
}

export async function apiArchiveService(shopId: string, serviceId: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/services/${serviceId}`, { method: 'DELETE' });
    return;
  }
  await ready();
  store.archiveService(shopId, serviceId);
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
  await ready();
  store.addPricingRule(shopId, rule as Parameters<typeof store.addPricingRule>[1]);
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
  await ready();
  store.updatePricingRule(shopId, ruleId, patch);
}

export async function apiDeletePricingRule(shopId: string, ruleId: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/pricing-rules/${ruleId}`, { method: 'DELETE' });
    return;
  }
  await ready();
  store.deletePricingRule(shopId, ruleId);
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
  await ready();
  store.addStaff(shopId, input);
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
  await ready();
  store.patchStaff(shopId, staffId, patch);
}

export async function apiArchiveStaff(shopId: string, staffId: string): Promise<boolean> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/staff/${staffId}`, { method: 'DELETE' });
    return res.ok;
  }
  await ready();
  try {
    store.archiveStaff(shopId, staffId);
    return true;
  } catch {
    return false; // last team member — refuse rather than empty the calendar
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
  await ready();
  store.addLocation(shopId, input);
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
  await ready();
  store.patchLocation(shopId, locationId, patch);
}

export async function apiDeleteLocation(shopId: string, locationId: string): Promise<boolean> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/locations/${locationId}`, { method: 'DELETE' });
    return res.ok;
  }
  await ready();
  try {
    store.deleteLocation(shopId, locationId);
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

export async function apiRevenueReport(shopId: string, from: string, to: string): Promise<RevenueReport | null> {
  if (backendMode() === 'server') {
    const res = await fetch(`/api/shop/${shopId}/revenue?from=${from}&to=${to}`);
    return res.ok ? await res.json() : null;
  }
  await readyForRead();
  return store.revenueReport(shopId, from, to);
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
  await ready();
  store.addAbsence(staffId, input);
}

export async function apiDeleteAbsence(shopId: string, staffId: string, absenceId: string): Promise<void> {
  if (backendMode() === 'server') {
    await fetch(`/api/shop/${shopId}/staff/${staffId}/absences/${absenceId}`, { method: 'DELETE' });
    return;
  }
  await ready();
  store.deleteAbsence(staffId, absenceId);
}

export type { HrRow, RevenueReport, Absence, AbsenceKind };
