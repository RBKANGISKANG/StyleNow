/**
 * Demo store — an in-memory stand-in for the real API + Postgres.
 *
 * It reuses the scaffold's pure domain modules verbatim (availability
 * projection, dynamic pricing, matching, cancellation outcomes) and mirrors the
 * booking service's semantics: seat-before-money, 8-minute holds, idempotency
 * keys, and 409-with-alternatives when a slot is taken. What Postgres enforces
 * with EXCLUDE constraints the demo enforces with an overlap check — same
 * contract, weaker guarantee, which is exactly why production keeps Postgres.
 */
import {
  slotsForStaff,
  aggregateSlots,
  overlaps,
  mergeIntervals,
  type Interval,
  type ServiceTiming,
  type StaffDay,
} from '@stylenow/api/domain/availability';
import {
  evaluatePrice,
  cancellationOutcome,
  type PriceContext,
} from '@stylenow/api/domain/pricing';
import { rank, type MatchCandidate, type MatchQuery } from '@stylenow/api/domain/matching';
import {
  aggregate,
  occupancyForBasket,
  HOLD_TTL_SECONDS,
} from '@stylenow/api/modules/booking/booking.service';
import { SHOPS, USER_LOCATION, type SeedShop, type SeedService } from './seed';
import { dayStart, isoDateOf, isoDow, minuteOfDay, addDays, todayIso } from './time';

const MIN = 60_000;

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

export type BookingStatus =
  | 'hold'
  | 'pending_payment'
  | 'confirmed'
  | 'completed'
  | 'no_show'
  | 'cancelled_by_customer'
  | 'cancelled_by_shop';

export interface Booking {
  id: string;
  reference: string;
  deviceId: string;
  shopId: string;
  serviceIds: string[];
  staffId: string;
  startsAt: number;
  endsAt: number;
  staffRanges: Interval[];
  status: BookingStatus;
  holdExpiresAt: number | null;
  quote: {
    subtotalCents: number;
    travelFeeCents: number;
    discountCents: number;
    vatCents: number;
    totalCents: number;
    depositCents: number;
    breakdown: Array<{ label: string; cents: number }>;
  };
  paidCents: number;
  guestName: string;
  policySnapshot: { freeUntilHours: number; lateFeePercent: number; noShowFeePercent: number };
  cancellation?: { feeCents: number; refundCents: number; reason: string };
  createdAt: number;
}

interface State {
  bookings: Map<string, Booking>;
  idempotency: Map<string, unknown>;
  ruleDisabled: Set<string>;
  serviceOverrides: Map<string, Partial<SeedService>>;
  seq: number;
}

// Survives Next.js dev-server HMR; resets on process restart (demo only).
const g = globalThis as typeof globalThis & { __stylenow?: State };
const state: State =
  g.__stylenow ??
  (g.__stylenow = {
    bookings: new Map(),
    idempotency: new Map(),
    ruleDisabled: new Set(),
    serviceOverrides: new Map(),
    seq: 1,
  });

// ---------------------------------------------------------------------------
// persistence — in the browser (static/local mode) state survives reloads via
// localStorage; in supabase mode the same state is hydrated from Postgres and
// localStorage is left alone.
// ---------------------------------------------------------------------------

const IS_BROWSER = typeof window !== 'undefined';
const LS_KEY = 'sn-state-v1';
let persistenceEnabled = IS_BROWSER;

export function setLocalPersistence(on: boolean): void {
  persistenceEnabled = IS_BROWSER && on;
}

function persist(): void {
  if (!persistenceEnabled) return;
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        bookings: [...state.bookings.values()],
        ruleDisabled: [...state.ruleDisabled],
        serviceOverrides: [...state.serviceOverrides.entries()],
        seq: state.seq,
      }),
    );
  } catch {
    // quota exceeded / private mode — demo keeps working in memory
  }
}

if (IS_BROWSER && state.bookings.size === 0) {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const d = JSON.parse(raw) as {
        bookings: Booking[];
        ruleDisabled: string[];
        serviceOverrides: Array<[string, Partial<SeedService>]>;
        seq: number;
      };
      state.bookings = new Map(d.bookings.map((b) => [b.id, b]));
      state.ruleDisabled = new Set(d.ruleDisabled);
      state.serviceOverrides = new Map(d.serviceOverrides);
      state.seq = d.seq ?? state.bookings.size + 1;
    }
  } catch {
    // corrupted snapshot — start fresh
  }
}

/** Replace live state from an external source of truth (Supabase sync). */
export function applyExternalState(snapshot: {
  bookings: Booking[];
  ruleDisabled: string[];
  serviceOverrides: Array<[string, Partial<SeedService>]>;
}): void {
  state.bookings = new Map(snapshot.bookings.map((b) => [b.id, b]));
  state.ruleDisabled = new Set(snapshot.ruleDisabled);
  state.serviceOverrides = new Map(snapshot.serviceOverrides);
  state.seq = Math.max(state.seq, state.bookings.size + 1);
}

export function ruleDisabledIds(): string[] {
  return [...state.ruleDisabled];
}

export function serviceOverrideEntries(): Array<[string, Partial<SeedService>]> {
  return [...state.serviceOverrides.entries()];
}

/** Roll a locally created booking back (Supabase race lost). */
export function deleteBooking(id: string): void {
  state.bookings.delete(id);
  persist();
}

// ---------------------------------------------------------------------------
// shop lookups
// ---------------------------------------------------------------------------

export function allShops(): SeedShop[] {
  return SHOPS;
}
export function shopBySlug(slug: string): SeedShop | undefined {
  return SHOPS.find((s) => s.slug === slug);
}
export function shopById(id: string): SeedShop | undefined {
  return SHOPS.find((s) => s.id === id);
}

export function serviceOf(shop: SeedShop, serviceId: string): SeedService | undefined {
  const base = shop.services.find((s) => s.id === serviceId);
  if (!base) return undefined;
  const override = state.serviceOverrides.get(serviceId);
  return override ? { ...base, ...override } : base;
}

export function activeRules(shop: SeedShop) {
  return shop.pricingRules.filter((r) => !state.ruleDisabled.has(r.id));
}

export function isRuleEnabled(ruleId: string): boolean {
  return !state.ruleDisabled.has(ruleId);
}

// ---------------------------------------------------------------------------
// deterministic walk-in noise, so calendars look alive
// ---------------------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pseudo walk-ins blocking parts of each staff member's day. */
export function seedBusy(staffId: string, isoDate: string, windows: Interval[]): Interval[] {
  const rand = mulberry32(hash(`${staffId}:${isoDate}`));
  const busy: Interval[] = [];
  for (const w of windows) {
    const spanMin = (w.end - w.start) / MIN;
    const blocks = Math.min(2 + Math.floor(rand() * 3), Math.floor(spanMin / 120));
    for (let i = 0; i < blocks; i++) {
      const durMin = 30 + Math.floor(rand() * 4) * 15; // 30–75 min
      const latest = spanMin - durMin;
      if (latest <= 0) continue;
      const startMin = Math.floor((rand() * latest) / 15) * 15;
      busy.push({ start: w.start + startMin * MIN, end: w.start + (startMin + durMin) * MIN });
    }
  }
  return mergeIntervals(busy);
}

// ---------------------------------------------------------------------------
// live occupancy
// ---------------------------------------------------------------------------

const BLOCKING: BookingStatus[] = ['hold', 'pending_payment', 'confirmed', 'completed'];

function bookingBlocks(b: Booking, now: number): boolean {
  if (!BLOCKING.includes(b.status)) return false;
  if ((b.status === 'hold' || b.status === 'pending_payment') && b.holdExpiresAt && b.holdExpiresAt < now) {
    return false; // hold expired → seat released, lazily
  }
  return true;
}

function liveBusy(staffId: string, day: Interval, now: number, excludeBookingId?: string): Interval[] {
  const out: Interval[] = [];
  for (const b of state.bookings.values()) {
    if (b.staffId !== staffId || b.id === excludeBookingId) continue;
    if (!bookingBlocks(b, now)) continue;
    for (const r of b.staffRanges) if (overlaps(r, day)) out.push(r);
  }
  return out;
}

function staffWindows(shop: SeedShop, staffId: string, isoDate: string): Interval[] {
  const staff = shop.staff.find((s) => s.id === staffId);
  if (!staff) return [];
  const start = dayStart(isoDate);
  const dow = isoDow(start + 12 * 60 * MIN);
  return (staff.shifts[dow] ?? []).map((w) => ({
    start: start + w.startMin * MIN,
    end: start + w.endMin * MIN,
  }));
}

function staffDayOf(
  shop: SeedShop,
  staffId: string,
  isoDate: string,
  now: number,
  excludeBookingId?: string,
): StaffDay {
  const working = staffWindows(shop, staffId, isoDate);
  const dayInterval: Interval = { start: dayStart(isoDate), end: dayStart(isoDate) + 24 * 60 * MIN };
  return {
    staffId,
    working,
    busy: [...seedBusy(staffId, isoDate, working), ...liveBusy(staffId, dayInterval, now, excludeBookingId)],
  };
}

/** 0–100: how much of the shop's working time that day is already taken. */
function occupancyPct(shop: SeedShop, isoDate: string, now: number): number {
  let work = 0;
  let busy = 0;
  for (const st of shop.staff) {
    const day = staffDayOf(shop, st.id, isoDate, now);
    for (const w of day.working) work += w.end - w.start;
    for (const b of mergeIntervals(day.busy)) busy += b.end - b.start;
  }
  return work === 0 ? 0 : Math.min(Math.round((busy / work) * 100), 100);
}

// ---------------------------------------------------------------------------
// customer history (drives new-customer + anti-gouging rules)
// ---------------------------------------------------------------------------

function isNewCustomer(deviceId: string): boolean {
  for (const b of state.bookings.values()) {
    if (b.deviceId === deviceId && ['confirmed', 'completed'].includes(b.status)) return false;
  }
  return true;
}

function isRepeatOfService(deviceId: string, shopId: string, serviceIds: string[], now: number): boolean {
  const cutoff = now - 90 * 24 * 60 * MIN;
  for (const b of state.bookings.values()) {
    if (b.deviceId !== deviceId || b.shopId !== shopId) continue;
    if (!['confirmed', 'completed'].includes(b.status)) continue;
    if (b.createdAt < cutoff) continue;
    if (b.serviceIds.some((s) => serviceIds.includes(s))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// pricing
// ---------------------------------------------------------------------------

export interface SlotQuote {
  subtotalCents: number;
  baseCents: number;
  applied: Array<{ name: string; deltaCents: number }>;
}

function priceBasket(
  shop: SeedShop,
  services: SeedService[],
  slotStart: number,
  now: number,
  deviceId: string,
  staffTier: string,
): SlotQuote {
  const rules = activeRules(shop);
  const ctxShared = {
    slotStart,
    now,
    occupancyPct: occupancyPct(shop, isoDateOf(slotStart), now),
    dow: isoDow(slotStart),
    minuteOfDay: minuteOfDay(slotStart),
    isoDate: isoDateOf(slotStart),
    staffTier,
    isNewCustomer: isNewCustomer(deviceId),
    isRepeatOfSameServiceWithin90d: isRepeatOfService(
      deviceId,
      shop.id,
      services.map((s) => s.id),
      now,
    ),
  };

  let subtotal = 0;
  let base = 0;
  const applied: Array<{ name: string; deltaCents: number }> = [];
  for (const svc of services) {
    base += svc.basePriceCents;
    if (!svc.dynamicPricing || rules.length === 0) {
      subtotal += svc.basePriceCents;
      continue;
    }
    const ctx: PriceContext = { ...ctxShared, basePriceCents: svc.basePriceCents };
    const r = evaluatePrice(rules, ctx);
    subtotal += r.finalPriceCents;
    for (const a of r.applied) applied.push({ name: a.name, deltaCents: a.deltaCents });
  }
  return { subtotalCents: subtotal, baseCents: base, applied };
}

// ---------------------------------------------------------------------------
// availability
// ---------------------------------------------------------------------------

export interface ApiSlot {
  start: number;
  end: number;
  staffIds: string[];
  suggestedStaffId: string;
  priceCents: number;
  basePriceCents: number;
  appliedNames: string[];
}

export function availability(
  shopId: string,
  serviceIds: string[],
  isoDate: string,
  deviceId: string,
  staffId?: string | null,
): { slots: ApiSlot[]; timing: ServiceTiming } {
  const shop = shopById(shopId);
  if (!shop) throw new Error('shop_not_found');
  const services = serviceIds
    .map((id) => serviceOf(shop, id))
    .filter((s): s is SeedService => Boolean(s));
  if (services.length === 0) throw new Error('service_not_found');

  const now = Date.now();
  const timing = aggregate(services);
  const staffPool = staffId ? shop.staff.filter((s) => s.id === staffId) : shop.staff;

  const loadByStaff: Record<string, number> = {};
  const perStaff = staffPool.flatMap((st) => {
    const day = staffDayOf(shop, st.id, isoDate, now);
    loadByStaff[st.id] = day.busy.length;
    return slotsForStaff(day, timing, shop.rules, now);
  });

  const slots = aggregateSlots(perStaff, loadByStaff).map((s) => {
    const tier = shop.staff.find((st) => st.id === s.suggestedStaffId)?.tier ?? 'stylist';
    const q = priceBasket(shop, services, s.start, now, deviceId, tier);
    return {
      ...s,
      priceCents: q.subtotalCents,
      basePriceCents: q.baseCents,
      appliedNames: q.applied.filter((a) => a.deltaCents !== 0).map((a) => a.name),
    };
  });

  return { slots, timing };
}

function minutesToFirstSlot(shop: SeedShop, now: number): number | null {
  const svc = shop.services.find((s) => s.popular) ?? shop.services[0];
  for (let d = 0; d < 7; d++) {
    const iso = addDays(todayIso(), d);
    const { slots } = availability(shop.id, [svc.id], iso, '__probe__');
    const first = slots.find((s) => s.start > now);
    if (first) return Math.round((first.start - now) / MIN);
  }
  return null;
}

// ---------------------------------------------------------------------------
// discovery feed
// ---------------------------------------------------------------------------

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

export interface FeedQuery {
  category?: string;
  search?: string;
  maxTravelM?: number;
  budgetCents?: number;
  wantsSoon?: boolean;
  personalisationConsent?: boolean;
  locale?: string;
}

export interface FeedCard {
  shopId: string;
  slug: string;
  name: string;
  category: string;
  district: string;
  emoji: string;
  gradient: [string, string];
  tagline: { en: string; de: string };
  ratingAvg: number;
  ratingCount: number;
  priceFromCents: number;
  distanceM: number;
  isNew: boolean;
  isMobile: boolean;
  score: number;
  reasons: string[];
  minutesToFirstSlot: number | null;
  languages: string[];
}

export function feed(q: FeedQuery): FeedCard[] {
  const now = Date.now();
  let shops = allShops();
  if (q.category) shops = shops.filter((s) => s.category === q.category);
  if (q.search) {
    const needle = q.search.toLowerCase();
    shops = shops.filter((s) => {
      const hay = [
        s.name,
        s.district,
        s.tagline.en,
        s.tagline.de,
        ...s.tags,
        ...s.services.flatMap((sv) => [sv.name.en, sv.name.de]),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  const firstSlot = new Map<string, number | null>();
  const candidates: MatchCandidate[] = shops.map((s) => {
    const mins = minutesToFirstSlot(s, now);
    firstSlot.set(s.id, mins);
    return {
      shopId: s.id,
      distanceM: haversineM(USER_LOCATION, { lat: s.lat, lng: s.lng }),
      ratingAvg: s.ratingAvg,
      ratingCount: s.ratingCount,
      priceFromCents: Math.min(...s.services.map((sv) => sv.basePriceCents)),
      semanticSimilarity: s.semanticSimilarity,
      tagOverlap: q.category && s.category === q.category ? 1 : 0.3,
      minutesToFirstSlot: mins,
      languagesSpoken: s.languagesSpoken,
      completionRate: 0.97,
      cancellationRate: s.cancellationRate,
      isNew: s.isNew,
      isMobile: s.isMobile,
      chainId: s.chainId,
    };
  });

  const query: MatchQuery = {
    maxTravelM: q.maxTravelM ?? 8000,
    budgetCents: q.budgetCents,
    preferredLanguages: [q.locale?.startsWith('de') ? 'de' : 'en'],
    wantsSoon: q.wantsSoon ?? false,
    personalisationConsent: q.personalisationConsent ?? false,
  };

  return rank(candidates, query, 50).map((m) => {
    const s = shopById(m.shopId)!;
    return {
      shopId: s.id,
      slug: s.slug,
      name: s.name,
      category: s.category,
      district: s.district,
      emoji: s.emoji,
      gradient: s.gradient,
      tagline: s.tagline,
      ratingAvg: s.ratingAvg,
      ratingCount: s.ratingCount,
      priceFromCents: Math.min(...s.services.map((sv) => sv.basePriceCents)),
      distanceM: haversineM(USER_LOCATION, { lat: s.lat, lng: s.lng }),
      isNew: s.isNew,
      isMobile: s.isMobile,
      score: m.score,
      reasons: m.reasons,
      minutesToFirstSlot: firstSlot.get(s.id) ?? null,
      languages: s.languagesSpoken,
    };
  });
}

// ---------------------------------------------------------------------------
// booking: hold → confirm → cancel
// ---------------------------------------------------------------------------

export class SlotTaken extends Error {
  constructor(readonly alternatives: ApiSlot[]) {
    super('slot_taken');
  }
}
export class HoldExpired extends Error {}

export interface HoldInput {
  shopId: string;
  serviceIds: string[];
  staffId?: string | null;
  startsAt: number;
  deviceId: string;
  guestName: string;
  idempotencyKey: string;
}

export interface HoldResult {
  bookingId: string;
  reference: string;
  holdExpiresAt: number;
  quote: Booking['quote'];
  clientSecret: string;
}

export function createHold(input: HoldInput): HoldResult {
  const cached = state.idempotency.get(input.idempotencyKey) as HoldResult | undefined;
  if (cached) return cached;

  const shop = shopById(input.shopId);
  if (!shop) throw new Error('shop_not_found');
  const services = input.serviceIds
    .map((id) => serviceOf(shop, id))
    .filter((s): s is SeedService => Boolean(s));
  if (services.length === 0) throw new Error('service_not_found');

  const now = Date.now();
  const isoDate = isoDateOf(input.startsAt);
  const timing = aggregate(services);

  // Resolve staff: requested, or the least-loaded member free at this time.
  let staffId = input.staffId ?? null;
  if (!staffId) {
    const { slots } = availability(input.shopId, input.serviceIds, isoDate, input.deviceId);
    staffId = slots.find((s) => s.start === input.startsAt)?.suggestedStaffId ?? null;
  }

  const conflict = (id: string): boolean => {
    const day = staffDayOf(shop, id, isoDate, now);
    const held = occupancyForBasket(input.startsAt, services, shop.rules);
    const inWindow = day.working.some(
      (w) => input.startsAt >= w.start && input.startsAt + timing.durationMin * MIN <= w.end,
    );
    return !inWindow || held.some((h) => day.busy.some((b) => overlaps(h, b)));
  };

  // The EXCLUDE-constraint stand-in: overlapping seat → 409 with alternatives.
  if (!staffId || conflict(staffId)) {
    const { slots } = availability(input.shopId, input.serviceIds, isoDate, input.deviceId);
    const alternatives = slots
      .filter((s) => s.start !== input.startsAt)
      .sort((a, b) => Math.abs(a.start - input.startsAt) - Math.abs(b.start - input.startsAt))
      .slice(0, 6)
      .sort((a, b) => a.start - b.start);
    throw new SlotTaken(alternatives);
  }

  const tier = shop.staff.find((s) => s.id === staffId)?.tier ?? 'stylist';
  const q = priceBasket(shop, services, input.startsAt, now, input.deviceId, tier);
  const travelFeeCents = shop.isMobile ? 1500 : 0;
  const totalCents = Math.max(q.subtotalCents + travelFeeCents, 0);
  const vatCents = services.reduce((sum, s) => {
    const share = q.subtotalCents === 0 ? 0 : s.basePriceCents / q.baseCents;
    const line = Math.round(q.subtotalCents * share);
    return sum + Math.round((line * s.vatRateBps) / (10_000 + s.vatRateBps));
  }, 0);
  const depositCents = Math.round((totalCents * shop.depositPercent) / 100);

  const breakdown: Array<{ label: string; cents: number }> = services.map((s) => ({
    label: s.name.en,
    cents: s.basePriceCents,
  }));
  for (const a of q.applied) if (a.deltaCents !== 0) breakdown.push({ label: a.name, cents: a.deltaCents });
  if (travelFeeCents) breakdown.push({ label: 'Travel fee', cents: travelFeeCents });

  const id = `bk-${state.seq++}-${now.toString(36)}`;
  const reference = `SN-${(hash(id) % 100_000_000).toString().padStart(8, '0')}`;
  const booking: Booking = {
    id,
    reference,
    deviceId: input.deviceId,
    shopId: input.shopId,
    serviceIds: services.map((s) => s.id),
    staffId,
    startsAt: input.startsAt,
    endsAt: input.startsAt + timing.durationMin * MIN + timing.processingGapMin * MIN + timing.finishMin * MIN,
    staffRanges: occupancyForBasket(input.startsAt, services, shop.rules),
    status: 'pending_payment',
    holdExpiresAt: now + HOLD_TTL_SECONDS * 1000,
    quote: { subtotalCents: q.subtotalCents, travelFeeCents, discountCents: 0, vatCents, totalCents, depositCents, breakdown },
    paidCents: 0,
    guestName: input.guestName,
    policySnapshot: { ...shop.policy },
    createdAt: now,
  };
  state.bookings.set(id, booking);

  const result: HoldResult = {
    bookingId: id,
    reference,
    holdExpiresAt: booking.holdExpiresAt!,
    quote: booking.quote,
    clientSecret: `demo_pi_${id}`,
  };
  state.idempotency.set(input.idempotencyKey, result);
  persist();
  return result;
}

export function confirmBooking(id: string): Booking {
  const b = state.bookings.get(id);
  if (!b) throw new Error('not_found');
  if (b.status === 'confirmed') return b;
  if (b.status !== 'hold' && b.status !== 'pending_payment') throw new HoldExpired();
  if (b.holdExpiresAt && b.holdExpiresAt < Date.now()) throw new HoldExpired();
  b.status = 'confirmed';
  b.holdExpiresAt = null;
  b.paidCents = b.quote.depositCents > 0 ? b.quote.depositCents : b.quote.totalCents;
  persist();
  return b;
}

export function cancelBooking(
  id: string,
  opts: { preview: boolean; by: 'customer' | 'shop'; isNoShow?: boolean },
): { feeCents: number; refundCents: number; reason: string; booking: Booking } {
  const b = state.bookings.get(id);
  if (!b) throw new Error('not_found');
  const outcome = cancellationOutcome({
    totalCents: b.quote.totalCents,
    paidCents: b.paidCents,
    startsAt: b.startsAt,
    cancelledAt: Date.now(),
    freeUntilHours: b.policySnapshot.freeUntilHours,
    lateFeePercent: b.policySnapshot.lateFeePercent,
    noShowFeePercent: b.policySnapshot.noShowFeePercent,
    isNoShow: opts.isNoShow ?? false,
    cancelledBy: opts.by,
  });
  if (!opts.preview) {
    b.status = opts.isNoShow
      ? 'no_show'
      : opts.by === 'customer'
        ? 'cancelled_by_customer'
        : 'cancelled_by_shop';
    b.cancellation = outcome;
    persist();
  }
  return { ...outcome, booking: b };
}

export function getBooking(id: string): Booking | undefined {
  return state.bookings.get(id);
}

export function bookingsForDevice(deviceId: string): Booking[] {
  return [...state.bookings.values()]
    .filter((b) => b.deviceId === deviceId && b.status !== 'hold')
    .sort((a, b) => b.startsAt - a.startsAt);
}

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------

export interface CalendarBlock {
  kind: 'booking' | 'walk_in';
  bookingId?: string;
  reference?: string;
  guestName?: string;
  serviceNames?: string[];
  status?: BookingStatus;
  totalCents?: number;
  start: number;
  end: number;
}

export function dashboardOverview(shopId: string, isoDate: string) {
  const shop = shopById(shopId);
  if (!shop) throw new Error('shop_not_found');
  const now = Date.now();
  const dStart = dayStart(isoDate);
  const dEnd = dStart + 24 * 60 * MIN;
  const dayInterval: Interval = { start: dStart, end: dEnd };

  const staffRows = shop.staff.map((st) => {
    const working = staffWindows(shop, st.id, isoDate);
    const blocks: CalendarBlock[] = seedBusy(st.id, isoDate, working).map((b) => ({
      kind: 'walk_in',
      start: b.start,
      end: b.end,
    }));
    for (const b of state.bookings.values()) {
      if (b.staffId !== st.id || !bookingBlocks(b, now)) continue;
      if (!overlaps({ start: b.startsAt, end: b.endsAt }, dayInterval)) continue;
      blocks.push({
        kind: 'booking',
        bookingId: b.id,
        reference: b.reference,
        guestName: b.guestName,
        serviceNames: b.serviceIds.map((id) => serviceOf(shop, id)?.name.en ?? id),
        status: b.status,
        totalCents: b.quote.totalCents,
        start: b.startsAt,
        end: b.endsAt,
      });
    }
    blocks.sort((a, b) => a.start - b.start);
    return { staffId: st.id, name: st.name, role: st.role, working, blocks };
  });

  const todaysBookings = [...state.bookings.values()]
    .filter((b) => b.shopId === shopId && b.startsAt >= dStart && b.startsAt < dEnd && b.status !== 'hold')
    .sort((a, b) => a.startsAt - b.startsAt);

  const revenueCents = todaysBookings
    .filter((b) => ['confirmed', 'completed'].includes(b.status))
    .reduce((sum, b) => sum + b.quote.totalCents, 0);

  const week = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(isoDate, i - 6);
    const s = dayStart(iso);
    const e = s + 24 * 60 * MIN;
    const real = [...state.bookings.values()]
      .filter(
        (b) => b.shopId === shopId && b.startsAt >= s && b.startsAt < e && ['confirmed', 'completed'].includes(b.status),
      )
      .reduce((sum, b) => sum + b.quote.totalCents, 0);
    // Walk-in noise gives the chart a believable baseline.
    const noise = (hash(`${shopId}:${iso}:rev`) % 40_000) + 25_000;
    return { iso, revenueCents: real + noise };
  });

  return {
    shop: {
      id: shop.id,
      name: shop.name,
      emoji: shop.emoji,
      services: shop.services.map((s) => ({ ...s, ...(state.serviceOverrides.get(s.id) ?? {}) })),
      pricingRules: shop.pricingRules.map((r) => ({ ...r, enabled: !state.ruleDisabled.has(r.id) })),
      depositPercent: shop.depositPercent,
      policy: shop.policy,
    },
    isoDate,
    occupancyPct: occupancyPct(shop, isoDate, now),
    revenueCents,
    bookingCount: todaysBookings.length,
    staffRows,
    bookings: todaysBookings.map((b) => ({
      id: b.id,
      reference: b.reference,
      guestName: b.guestName,
      serviceNames: b.serviceIds.map((id) => serviceOf(shop, id)?.name.en ?? id),
      staffName: shop.staff.find((s) => s.id === b.staffId)?.name ?? '—',
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      status: b.status,
      totalCents: b.quote.totalCents,
      paidCents: b.paidCents,
    })),
    week,
  };
}

export function setBookingStatus(
  shopId: string,
  bookingId: string,
  status: 'completed' | 'no_show' | 'cancelled_by_shop',
): Booking {
  const b = state.bookings.get(bookingId);
  if (!b || b.shopId !== shopId) throw new Error('not_found');
  if (status === 'completed') {
    b.status = 'completed';
    b.paidCents = b.quote.totalCents;
    persist();
    return b;
  }
  return cancelBooking(bookingId, {
    preview: false,
    by: 'shop',
    isNoShow: status === 'no_show',
  }).booking;
}

export function patchService(
  shopId: string,
  serviceId: string,
  patch: { basePriceCents?: number; durationMin?: number; dynamicPricing?: boolean },
): void {
  const shop = shopById(shopId);
  if (!shop || !shop.services.some((s) => s.id === serviceId)) throw new Error('not_found');
  const current = state.serviceOverrides.get(serviceId) ?? {};
  state.serviceOverrides.set(serviceId, { ...current, ...patch });
  persist();
}

export function toggleRule(shopId: string, ruleId: string): boolean {
  const shop = shopById(shopId);
  if (!shop || !shop.pricingRules.some((r) => r.id === ruleId)) throw new Error('not_found');
  if (state.ruleDisabled.has(ruleId)) state.ruleDisabled.delete(ruleId);
  else state.ruleDisabled.add(ruleId);
  persist();
  return !state.ruleDisabled.has(ruleId);
}

// ---------------------------------------------------------------------------
// customer-facing booking view (shared by the API route and the local backend)
// ---------------------------------------------------------------------------

export interface BookingView {
  id: string;
  reference: string;
  status: BookingStatus;
  startsAt: number;
  endsAt: number;
  totalCents: number;
  paidCents: number;
  depositCents: number;
  cancellation: { feeCents: number; refundCents: number; reason: string } | null;
  policy: { freeUntilHours: number; lateFeePercent: number; noShowFeePercent: number };
  shop: { slug: string; name: string; emoji: string; district: string; gradient: [string, string] } | null;
  services: Array<{ name: { en: string; de: string }; emoji: string }>;
  staffName: string | null;
}

export function bookingsForDeviceView(deviceId: string): BookingView[] {
  return bookingsForDevice(deviceId).map((b) => {
    const shop = shopById(b.shopId);
    return {
      id: b.id,
      reference: b.reference,
      status: b.status,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      totalCents: b.quote.totalCents,
      paidCents: b.paidCents,
      depositCents: b.quote.depositCents,
      cancellation: b.cancellation ?? null,
      policy: b.policySnapshot,
      shop: shop
        ? { slug: shop.slug, name: shop.name, emoji: shop.emoji, district: shop.district, gradient: shop.gradient }
        : null,
      services: b.serviceIds.map((id) => {
        const s = shop ? serviceOf(shop, id) : undefined;
        return s ? { name: s.name, emoji: s.emoji } : { name: { en: id, de: id }, emoji: '✨' };
      }),
      staffName: shop?.staff.find((s) => s.id === b.staffId)?.name ?? null,
    };
  });
}
