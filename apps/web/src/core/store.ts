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
  type PricingRule,
} from '@stylenow/api/domain/pricing';
import { rank, type MatchCandidate, type MatchQuery } from '@stylenow/api/domain/matching';
import {
  aggregate,
  occupancyForBasket,
  HOLD_TTL_SECONDS,
} from '@stylenow/api/modules/booking/booking.service';
import {
  SHOPS,
  USER_LOCATION,
  VOUCHERS,
  LOYALTY_EARN_PER_EURO,
  LOYALTY_POINTS_PER_EURO_REDEEMED,
  type SeedShop,
  type SeedService,
  type Voucher,
} from './seed';
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
  review?: { rating: number; text: string; date: string };
  tipCents?: number;
  pointsSpent?: number;
  voucherCode?: string;
  createdAt: number;
}

export interface WaitlistEntry {
  id: string;
  deviceId: string;
  shopId: string;
  serviceIds: string[];
  isoDate: string;
  createdAt: number;
}

export interface ShopLocation {
  id: string;
  label: string;
  street: string;
  zip: string;
  city: string;
  district: string;
}

/** Same shape as the seed staff, plus location and the HR record. */
export interface StaffMember {
  id: string;
  name: string;
  role: { en: string; de: string };
  tier: 'senior' | 'stylist';
  shifts: Partial<Record<number, Array<{ startMin: number; endMin: number }>>>;
  locationId?: string;
  // HR
  email?: string;
  phone?: string;
  employedSince?: string; // YYYY-MM-DD
  weeklyHours?: number;   // contracted hours per week
  notes?: string;
}

export type AbsenceKind = 'vacation' | 'sick' | 'training' | 'other';

export interface Absence {
  id: string;
  staffId: string;
  from: string; // YYYY-MM-DD inclusive
  to: string;   // YYYY-MM-DD inclusive
  kind: AbsenceKind;
  note?: string;
}

export interface ShopApplication {
  id: string;
  deviceId: string;
  status: 'pending' | 'approved' | 'rejected';
  data: Record<string, unknown>;
  createdAt: number;
}

interface State {
  bookings: Map<string, Booking>;
  idempotency: Map<string, unknown>;
  ruleDisabled: Set<string>;
  serviceOverrides: Map<string, Partial<SeedService>>;
  waitlist: Map<string, WaitlistEntry>;
  applications: Map<string, ShopApplication>;
  shopLogos: Map<string, string>;
  customCategories: Map<string, string>; // id → label
  shopOwners: Map<string, string>; // shopId → ownerKey (account email or device)
  customServices: Map<string, SeedService[]>; // shopId → services the shop added
  archivedServices: Set<string>; // services are archived, never dropped (old receipts must render)
  customRules: Map<string, PricingRule[]>; // shopId → rules the shop authored
  deletedRules: Set<string>;
  customStaff: Map<string, StaffMember[]>; // shopId → team members the shop added
  staffOverrides: Map<string, Partial<StaffMember>>; // edits to any team member
  archivedStaff: Set<string>;
  shopLocations: Map<string, ShopLocation[]>; // shopId → branches (Standorte)
  absences: Map<string, Absence[]>; // staffId → holiday / sick / training
  exitFeedback: ExitFeedback[]; // why people deleted an account or dropped a shop
  seq: number;
}

/** Answers collected before a deletion — the only chance to ask. */
export interface ExitFeedback {
  id: string;
  kind: 'account' | 'shop';
  /** email for an account, shop id for a shop — kept so support can follow up */
  subject: string;
  answers: Record<string, string>;
  at: number;
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
    waitlist: new Map(),
    applications: new Map(),
    shopLogos: new Map(),
    customCategories: new Map(),
    shopOwners: new Map(),
    customServices: new Map(),
    archivedServices: new Set(),
    customRules: new Map(),
    deletedRules: new Set(),
    customStaff: new Map(),
    staffOverrides: new Map(),
    archivedStaff: new Set(),
    shopLocations: new Map(),
    absences: new Map(),
    exitFeedback: [],
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

/** Bumped on every mutation so the derived-view caches below can invalidate. */
let stateVersion = 0;

function persist(): void {
  stateVersion += 1;
  if (!persistenceEnabled) return;
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        bookings: [...state.bookings.values()],
        ruleDisabled: [...state.ruleDisabled],
        serviceOverrides: [...state.serviceOverrides.entries()],
        waitlist: [...state.waitlist.values()],
        applications: [...state.applications.values()],
        shopLogos: [...state.shopLogos.entries()],
        customCategories: [...state.customCategories.entries()],
        shopOwners: [...state.shopOwners.entries()],
        customServices: [...state.customServices.entries()],
        archivedServices: [...state.archivedServices],
        customRules: [...state.customRules.entries()],
        deletedRules: [...state.deletedRules],
        customStaff: [...state.customStaff.entries()],
        staffOverrides: [...state.staffOverrides.entries()],
        archivedStaff: [...state.archivedStaff],
        shopLocations: [...state.shopLocations.entries()],
        absences: [...state.absences.entries()],
        exitFeedback: state.exitFeedback,
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
        waitlist?: WaitlistEntry[];
        applications?: ShopApplication[];
        shopLogos?: Array<[string, string]>;
        customCategories?: Array<[string, string]>;
        shopOwners?: Array<[string, string]>;
        customServices?: Array<[string, SeedService[]]>;
        archivedServices?: string[];
        customRules?: Array<[string, PricingRule[]]>;
        deletedRules?: string[];
        customStaff?: Array<[string, StaffMember[]]>;
        staffOverrides?: Array<[string, Partial<StaffMember>]>;
        archivedStaff?: string[];
        shopLocations?: Array<[string, ShopLocation[]]>;
        absences?: Array<[string, Absence[]]>;
        exitFeedback?: ExitFeedback[];
        seq: number;
      };
      state.bookings = new Map(d.bookings.map((b) => [b.id, b]));
      state.ruleDisabled = new Set(d.ruleDisabled);
      state.serviceOverrides = new Map(d.serviceOverrides);
      state.waitlist = new Map((d.waitlist ?? []).map((w) => [w.id, w]));
      state.applications = new Map((d.applications ?? []).map((a) => [a.id, a]));
      state.shopLogos = new Map(d.shopLogos ?? []);
      state.customCategories = new Map(d.customCategories ?? []);
      state.shopOwners = new Map(d.shopOwners ?? []);
      state.customServices = new Map(d.customServices ?? []);
      state.archivedServices = new Set(d.archivedServices ?? []);
      state.customRules = new Map(d.customRules ?? []);
      state.deletedRules = new Set(d.deletedRules ?? []);
      state.customStaff = new Map(d.customStaff ?? []);
      state.staffOverrides = new Map(d.staffOverrides ?? []);
      state.archivedStaff = new Set(d.archivedStaff ?? []);
      state.shopLocations = new Map(d.shopLocations ?? []);
      state.absences = new Map(d.absences ?? []);
      state.exitFeedback = d.exitFeedback ?? [];
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
  shopLogos?: Array<[string, string]>;
  customCategories?: Array<[string, string]>;
}): void {
  state.bookings = new Map(snapshot.bookings.map((b) => [b.id, b]));
  state.ruleDisabled = new Set(snapshot.ruleDisabled);
  state.serviceOverrides = new Map(snapshot.serviceOverrides);
  if (snapshot.shopLogos) state.shopLogos = new Map(snapshot.shopLogos);
  if (snapshot.customCategories) state.customCategories = new Map(snapshot.customCategories);
  stateVersion += 1;
  state.seq = Math.max(state.seq, state.bookings.size + 1);
}

// --- shop ownership: a dashboard only ever shows the operator's own shops ---

export function shopsForOwner(ownerKey: string): string[] {
  return [...state.shopOwners.entries()].filter(([, o]) => o === ownerKey).map(([id]) => id);
}

export function claimShop(shopId: string, ownerKey: string): void {
  state.shopOwners.set(shopId, ownerKey);
  persist();
}

export function releaseShop(shopId: string): void {
  state.shopOwners.delete(shopId);
  persist();
}

export function customCategories(): Array<{ id: string; label: string }> {
  return [...state.customCategories.entries()].map(([id, label]) => ({ id, label }));
}

/** A company adds a missing category; it becomes selectable for everyone. */
export function addCustomCategory(label: string): { id: string; label: string } {
  const clean = label.trim().slice(0, 40);
  const id = `custom-${clean.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-+|-+$/g, '')}`;
  if (!state.customCategories.has(id)) {
    state.customCategories.set(id, clean);
    persist();
  }
  return { id, label: state.customCategories.get(id)! };
}

export function getShopLogo(shopId: string): string | null {
  return state.shopLogos.get(shopId) ?? null;
}

export function setShopLogo(shopId: string, dataUrl: string | null): void {
  if (dataUrl) state.shopLogos.set(shopId, dataUrl);
  else state.shopLogos.delete(shopId);
  persist();
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
  const base =
    shop.services.find((s) => s.id === serviceId) ??
    (state.customServices.get(shop.id) ?? []).find((s) => s.id === serviceId);
  if (!base) return undefined;
  const override = state.serviceOverrides.get(serviceId);
  return override ? { ...base, ...override } : base;
}

/** Seed menu + services the shop added, minus archived, with edits applied. */
export const effectiveServices = memoByShop(function effectiveServicesUncached(shopId: string): SeedService[] {
  const shop = shopById(shopId);
  if (!shop) return [];
  return [...shop.services, ...(state.customServices.get(shopId) ?? [])]
    .filter((s) => !state.archivedServices.has(s.id))
    .map((s) => ({ categoryId: shop.category, ...s, ...(state.serviceOverrides.get(s.id) ?? {}) }));
});

/**
 * Derived views (team, menu, rules, branches) are read inside the slot
 * projection's hot loops — once per staff member per day per shop. Rebuilding
 * them every call made the discovery feed take seconds, so they are memoised
 * and invalidated by `stateVersion`.
 */
function memoByShop<T>(fn: (shopId: string) => T): (shopId: string) => T {
  const cache = new Map<string, { v: number; val: T }>();
  return (shopId: string) => {
    const hit = cache.get(shopId);
    if (hit && hit.v === stateVersion) return hit.val;
    const val = fn(shopId);
    cache.set(shopId, { v: stateVersion, val });
    return val;
  };
}

/** Seed team + members the shop added, minus archived, with edits applied. */
export const effectiveStaff = memoByShop(function effectiveStaffUncached(shopId: string): StaffMember[] {
  const shop = shopById(shopId);
  if (!shop) return [];
  const seed: StaffMember[] = shop.staff.map((s) => ({
    id: s.id,
    name: s.name,
    role: s.role,
    tier: s.tier,
    shifts: s.shifts,
  }));
  return [...seed, ...(state.customStaff.get(shopId) ?? [])]
    .filter((s) => !state.archivedStaff.has(s.id))
    .map((s) => ({ ...s, ...(state.staffOverrides.get(s.id) ?? {}) }));
});

export function addStaff(
  shopId: string,
  input: { name: string; role: string; tier?: 'senior' | 'stylist'; locationId?: string },
): StaffMember {
  const member: StaffMember = {
    id: `st-custom-${state.seq++}-${Date.now().toString(36)}`,
    name: input.name,
    role: { en: input.role, de: input.role },
    tier: input.tier ?? 'stylist',
    locationId: input.locationId,
    // Mon–Fri 09:00–18:00 by default; editable per person.
    shifts: Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, [{ startMin: 9 * 60, endMin: 18 * 60 }]])),
  };
  state.customStaff.set(shopId, [...(state.customStaff.get(shopId) ?? []), member]);
  persist();
  return member;
}

export function patchStaff(shopId: string, staffId: string, patch: Partial<StaffMember>): void {
  if (!effectiveStaff(shopId).some((s) => s.id === staffId)) throw new Error('not_found');
  state.staffOverrides.set(staffId, { ...(state.staffOverrides.get(staffId) ?? {}), ...patch });
  persist();
}

/** Archive: their past bookings must still render with a name. */
export function archiveStaff(shopId: string, staffId: string): void {
  if (effectiveStaff(shopId).length <= 1) throw new Error('last_staff');
  state.archivedStaff.add(staffId);
  persist();
}

// --- absences: holiday / sick leave / training ------------------------------
//
// An absence removes the person's working windows for those days entirely, so
// the slot projection can never offer a time while they are away — the same
// path the customer feed, the checkout and the dashboard all read from.

export function absencesFor(staffId: string): Absence[] {
  return [...(state.absences.get(staffId) ?? [])].sort((a, b) => (a.from < b.from ? -1 : 1));
}

export function isAbsent(staffId: string, isoDate: string): boolean {
  return (state.absences.get(staffId) ?? []).some((a) => isoDate >= a.from && isoDate <= a.to);
}

export function addAbsence(staffId: string, input: Omit<Absence, 'id' | 'staffId'>): Absence {
  const absence: Absence = { ...input, id: `abs-${state.seq++}-${Date.now().toString(36)}`, staffId };
  state.absences.set(staffId, [...(state.absences.get(staffId) ?? []), absence]);
  persist();
  return absence;
}

export function deleteAbsence(staffId: string, absenceId: string): void {
  state.absences.set(staffId, (state.absences.get(staffId) ?? []).filter((a) => a.id !== absenceId));
  persist();
}

// --- exit feedback ---------------------------------------------------------

/**
 * Kept deliberately separate from the deleted record: the account row goes
 * away, the reason it went away does not. Nothing here identifies the person
 * beyond the address they typed to confirm, which support needs to answer a
 * "why was I deleted" question later.
 */
export function recordExitFeedback(
  kind: ExitFeedback['kind'],
  subject: string,
  answers: Record<string, string>,
): void {
  state.exitFeedback = [
    ...state.exitFeedback,
    { id: `exit-${state.seq++}-${Date.now().toString(36)}`, kind, subject, answers, at: Date.now() },
  ];
  persist();
}

export function exitFeedback(): ExitFeedback[] {
  return [...state.exitFeedback];
}

// --- locations (Standorte) -------------------------------------------------

export const shopLocations = memoByShop(function shopLocationsUncached(shopId: string): ShopLocation[] {
  const stored = state.shopLocations.get(shopId);
  if (stored && stored.length) return stored;
  // Derive the first branch from the seed address so the list is never empty.
  const shop = shopById(shopId);
  if (!shop) return [];
  const [street = shop.address, rest = ''] = shop.address.split(',').map((x) => x.trim());
  const [zip = '', ...cityParts] = rest.split(' ');
  return [
    {
      id: `loc-${shopId}-main`,
      label: shop.name,
      street,
      zip,
      city: cityParts.join(' ') || 'Berlin',
      district: shop.district,
    },
  ];
});

export function addLocation(shopId: string, input: Omit<ShopLocation, 'id'>): ShopLocation {
  const loc: ShopLocation = { ...input, id: `loc-${state.seq++}-${Date.now().toString(36)}` };
  state.shopLocations.set(shopId, [...shopLocations(shopId), loc]);
  persist();
  return loc;
}

export function patchLocation(shopId: string, locationId: string, patch: Partial<ShopLocation>): void {
  const list = shopLocations(shopId).map((l) => (l.id === locationId ? { ...l, ...patch, id: l.id } : l));
  state.shopLocations.set(shopId, list);
  persist();
}

export function deleteLocation(shopId: string, locationId: string): void {
  const list = shopLocations(shopId);
  if (list.length <= 1) throw new Error('last_location');
  state.shopLocations.set(shopId, list.filter((l) => l.id !== locationId));
  // Staff attached to a removed branch fall back to the first one.
  for (const st of effectiveStaff(shopId)) {
    if (st.locationId === locationId) patchStaff(shopId, st.id, { locationId: undefined });
  }
  persist();
}

/** Seed rules + rules the shop authored, minus deleted. */
export const effectiveRules = memoByShop(function effectiveRulesUncached(shopId: string): PricingRule[] {
  const shop = shopById(shopId);
  if (!shop) return [];
  return [...shop.pricingRules, ...(state.customRules.get(shopId) ?? [])].filter(
    (r) => !state.deletedRules.has(r.id),
  );
});

export function activeRules(shop: SeedShop) {
  return effectiveRules(shop.id).filter((r) => !state.ruleDisabled.has(r.id));
}

// --- service & rule management (available to the shop at any time) ---------

export function addService(
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
): SeedService {
  const svc: SeedService = {
    id: `svc-custom-${state.seq++}-${Date.now().toString(36)}`,
    emoji: input.emoji || '✨',
    categoryId: input.categoryId ?? shopById(shopId)?.category,
    name: { en: input.name, de: input.name },
    durationMin: Math.max(5, Math.round(input.durationMin)),
    processingGapMin: Math.max(0, Math.round(input.processingGapMin ?? 0)),
    finishMin: 0,
    basePriceCents: Math.max(0, Math.round(input.basePriceCents)),
    vatRateBps: 1900,
    dynamicPricing: input.dynamicPricing ?? false,
  };
  state.customServices.set(shopId, [...(state.customServices.get(shopId) ?? []), svc]);
  persist();
  return svc;
}

/** Archive, never delete: a two-year-old receipt must still render. */
export function archiveService(shopId: string, serviceId: string): void {
  state.archivedServices.add(serviceId);
  persist();
}

export function addPricingRule(shopId: string, rule: Omit<PricingRule, 'id'>): PricingRule {
  const created: PricingRule = { ...rule, id: `pr-custom-${state.seq++}-${Date.now().toString(36)}` };
  state.customRules.set(shopId, [...(state.customRules.get(shopId) ?? []), created]);
  persist();
  return created;
}

export function updatePricingRule(shopId: string, ruleId: string, patch: Partial<PricingRule>): void {
  const list = state.customRules.get(shopId) ?? [];
  const idx = list.findIndex((r) => r.id === ruleId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...patch, id: ruleId };
    state.customRules.set(shopId, [...list]);
    persist();
    return;
  }
  // Editing a seed rule: shadow it with a custom copy and hide the original.
  const seed = shopById(shopId)?.pricingRules.find((r) => r.id === ruleId);
  if (!seed) throw new Error('not_found');
  state.deletedRules.add(ruleId);
  state.customRules.set(shopId, [...list, { ...seed, ...patch, id: `${ruleId}-edited` }]);
  persist();
}

export function deletePricingRule(shopId: string, ruleId: string): void {
  const list = state.customRules.get(shopId) ?? [];
  if (list.some((r) => r.id === ruleId)) {
    state.customRules.set(shopId, list.filter((r) => r.id !== ruleId));
  } else {
    state.deletedRules.add(ruleId);
  }
  persist();
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

const seedBusyCache = new Map<string, { v: number; val: Interval[] }>();

/** Pseudo walk-ins blocking parts of each staff member's day. */
export function seedBusy(staffId: string, isoDate: string, windows: Interval[]): Interval[] {
  const key = `${staffId}:${isoDate}:${windows.map((w) => `${w.start}-${w.end}`).join(',')}`;
  const hit = seedBusyCache.get(key);
  if (hit && hit.v === stateVersion) return hit.val;
  const val = seedBusyUncached(staffId, isoDate, windows);
  seedBusyCache.set(key, { v: stateVersion, val });
  return val;
}

function seedBusyUncached(staffId: string, isoDate: string, windows: Interval[]): Interval[] {
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
  const staff = effectiveStaff(shop.id).find((s) => s.id === staffId);
  if (!staff) return [];
  if (isAbsent(staffId, isoDate)) return []; // on holiday / sick / training
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

const occupancyCache = new Map<string, { v: number; val: number }>();

/**
 * 0–100: how much of the shop's working time that day is already taken.
 * Cached per shop-day (and per minute, since expired holds free seats over
 * time): the pricing engine asks for it once per slot, and computing it walks
 * every stylist's whole day.
 */
function occupancyPct(shop: SeedShop, isoDate: string, now: number): number {
  const key = `${shop.id}:${isoDate}:${Math.floor(now / 60_000)}`;
  const hit = occupancyCache.get(key);
  if (hit && hit.v === stateVersion) return hit.val;
  const val = occupancyPctUncached(shop, isoDate, now);
  occupancyCache.set(key, { v: stateVersion, val });
  return val;
}

function occupancyPctUncached(shop: SeedShop, isoDate: string, now: number): number {
  let work = 0;
  let busy = 0;
  for (const st of effectiveStaff(shop.id)) {
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

/**
 * Raw slot projection — no pricing. The discovery feed only needs to know
 * *when* the next free slot is, and pricing every slot of every shop to answer
 * that dominated the cold feed (seconds). Pricing stays in `availability()`,
 * which the booking UI uses.
 */
function projectSlots(
  shopId: string,
  serviceIds: string[],
  isoDate: string,
  staffId?: string | null,
): { slots: Array<{ start: number; end: number; staffIds: string[]; suggestedStaffId: string }>; timing: ServiceTiming } {
  const shop = shopById(shopId);
  if (!shop) throw new Error('shop_not_found');
  const services = serviceIds
    .map((id) => serviceOf(shop, id))
    .filter((s): s is SeedService => Boolean(s));
  if (services.length === 0) throw new Error('service_not_found');

  const now = Date.now();
  const timing = aggregate(services);
  const team = effectiveStaff(shopId);
  const staffPool = staffId ? team.filter((s) => s.id === staffId) : team;

  const loadByStaff: Record<string, number> = {};
  const perStaff = staffPool.flatMap((st) => {
    const day = staffDayOf(shop, st.id, isoDate, now);
    loadByStaff[st.id] = day.busy.length;
    return slotsForStaff(day, timing, shop.rules, now);
  });

  return { slots: aggregateSlots(perStaff, loadByStaff), timing };
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
  const team = effectiveStaff(shopId);
  const staffPool = staffId ? team.filter((s) => s.id === staffId) : team;

  const loadByStaff: Record<string, number> = {};
  const perStaff = staffPool.flatMap((st) => {
    const day = staffDayOf(shop, st.id, isoDate, now);
    loadByStaff[st.id] = day.busy.length;
    return slotsForStaff(day, timing, shop.rules, now);
  });

  const slots = aggregateSlots(perStaff, loadByStaff).map((s) => {
    const tier = effectiveStaff(shopId).find((st) => st.id === s.suggestedStaffId)?.tier ?? 'stylist';
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

const firstSlotCache = new Map<string, { v: number; val: number | null }>();

/** The discovery feed asks this for every shop; cache it per minute. */
function minutesToFirstSlot(shop: SeedShop, now: number): number | null {
  const key = `${shop.id}:${Math.floor(now / 60_000)}`;
  const hit = firstSlotCache.get(key);
  if (hit && hit.v === stateVersion) return hit.val;
  const val = minutesToFirstSlotUncached(shop, now);
  firstSlotCache.set(key, { v: stateVersion, val });
  return val;
}

function minutesToFirstSlotUncached(shop: SeedShop, now: number): number | null {
  const svc = shop.services.find((s) => s.popular) ?? shop.services[0];
  for (let d = 0; d < 7; d++) {
    const iso = addDays(todayIso(), d);
    const { slots } = projectSlots(shop.id, [svc.id], iso);
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
  /** search origin — a resolved address/postal code or browser GPS; defaults to the demo location */
  lat?: number;
  lng?: number;
  minRating?: number;
  sortBy?: 'match' | 'distance' | 'price' | 'rating';
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
  logoUrl: string | null;
}

export function feed(q: FeedQuery): FeedCard[] {
  const now = Date.now();
  const origin = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : USER_LOCATION;
  let shops = allShops();
  if (q.category) shops = shops.filter((s) => s.category === q.category);
  if (q.minRating) shops = shops.filter((s) => s.ratingAvg >= q.minRating!);
  if (q.search) {
    const needle = q.search.toLowerCase();
    shops = shops.filter((s) => {
      const hay = [
        s.name,
        s.district,
        s.address,
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
      distanceM: haversineM(origin, { lat: s.lat, lng: s.lng }),
      ratingAvg: s.ratingAvg,
      ratingCount: s.ratingCount,
      priceFromCents: Math.min(...effectiveServices(s.id).map((sv) => sv.basePriceCents)),
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

  const cards = rank(candidates, query, 50).map((m) => {
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
      priceFromCents: Math.min(...effectiveServices(s.id).map((sv) => sv.basePriceCents)),
      distanceM: haversineM(origin, { lat: s.lat, lng: s.lng }),
      isNew: s.isNew,
      isMobile: s.isMobile,
      score: m.score,
      reasons: m.reasons,
      minutesToFirstSlot: firstSlot.get(s.id) ?? null,
      languages: s.languagesSpoken,
      logoUrl: getShopLogo(s.id),
    };
  });

  switch (q.sortBy) {
    case 'distance':
      cards.sort((a, b) => a.distanceM - b.distanceM);
      break;
    case 'price':
      cards.sort((a, b) => a.priceFromCents - b.priceFromCents);
      break;
    case 'rating':
      cards.sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount);
      break;
    default:
      break; // 'match' — the ranking engine's order
  }
  return cards;
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
  voucherCode?: string;
  pointsToSpend?: number;
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

  const tier = effectiveStaff(input.shopId).find((s) => s.id === staffId)?.tier ?? 'stylist';
  const q = priceBasket(shop, services, input.startsAt, now, input.deviceId, tier);
  const travelFeeCents = shop.isMobile ? 1500 : 0;

  // Discounts: voucher first, then loyalty points on the remainder.
  let discountCents = 0;
  const discountLines: Array<{ label: string; cents: number }> = [];
  if (input.voucherCode) {
    const v = validateVoucher(input.voucherCode, q.subtotalCents);
    if (!v.ok) throw new Error('voucher_invalid');
    discountCents += v.discountCents;
    discountLines.push({ label: `Voucher ${v.voucher.code}`, cents: -v.discountCents });
  }
  let pointsSpent = 0;
  if (input.pointsToSpend && input.pointsToSpend > 0) {
    const balance = loyaltyBalance(input.deviceId);
    const remainder = Math.max(q.subtotalCents + travelFeeCents - discountCents, 0);
    pointsSpent = Math.min(input.pointsToSpend, balance);
    let pointsValue = Math.floor((pointsSpent / LOYALTY_POINTS_PER_EURO_REDEEMED) * 100);
    pointsValue = Math.min(pointsValue, remainder);
    pointsSpent = Math.ceil((pointsValue / 100) * LOYALTY_POINTS_PER_EURO_REDEEMED);
    if (pointsValue > 0) {
      discountCents += pointsValue;
      discountLines.push({ label: `Loyalty points (${pointsSpent})`, cents: -pointsValue });
    } else {
      pointsSpent = 0;
    }
  }

  const totalCents = Math.max(q.subtotalCents + travelFeeCents - discountCents, 0);
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
  breakdown.push(...discountLines);

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
    quote: { subtotalCents: q.subtotalCents, travelFeeCents, discountCents, vatCents, totalCents, depositCents, breakdown },
    paidCents: 0,
    guestName: input.guestName,
    pointsSpent: pointsSpent || undefined,
    voucherCode: input.voucherCode || undefined,
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

/**
 * Reschedule (move) a booking to a new time and/or stylist. The seat contract
 * is unchanged: the new window must be free (the booking's own current seat
 * doesn't count against it), otherwise SlotTaken with alternatives.
 */
export function rescheduleBooking(
  shopId: string,
  bookingId: string,
  newStartsAt: number,
  newStaffId?: string | null,
): Booking {
  const b = state.bookings.get(bookingId);
  if (!b || b.shopId !== shopId) throw new Error('not_found');
  if (!['confirmed', 'pending_payment'].includes(b.status)) throw new Error('not_movable');
  const shop = shopById(shopId);
  if (!shop) throw new Error('shop_not_found');
  const services = b.serviceIds
    .map((id) => serviceOf(shop, id))
    .filter((x): x is SeedService => Boolean(x));
  const timing = aggregate(services);
  const staffId = newStaffId ?? b.staffId;
  const now = Date.now();
  const isoDate = isoDateOf(newStartsAt);

  const day = staffDayOf(shop, staffId, isoDate, now, b.id);
  const held = occupancyForBasket(newStartsAt, services, shop.rules);
  const inWindow = day.working.some(
    (w) => newStartsAt >= w.start && newStartsAt + timing.durationMin * MIN <= w.end,
  );
  if (!inWindow || held.some((h) => day.busy.some((x) => overlaps(h, x)))) {
    const { slots } = availability(shopId, b.serviceIds, isoDate, b.deviceId, newStaffId ?? null);
    throw new SlotTaken(slots.slice(0, 6));
  }

  b.staffId = staffId;
  b.startsAt = newStartsAt;
  b.endsAt = newStartsAt + (timing.durationMin + timing.processingGapMin + timing.finishMin) * MIN;
  b.staffRanges = held;
  persist();
  return b;
}

/**
 * A booking created by the shop for a customer (walk-in or phone). Same seat
 * semantics as online checkout — the EXCLUDE contract still applies — but no
 * payment step: it confirms immediately and is settled at the shop.
 */
export function createShopBooking(
  shopId: string,
  serviceIds: string[],
  staffId: string | null,
  startsAt: number,
  guestName: string,
): Booking {
  const hold = createHold({
    shopId,
    serviceIds,
    staffId,
    startsAt,
    deviceId: `shop:${shopId}`,
    guestName,
    idempotencyKey: `shopbk-${shopId}-${startsAt}-${state.seq}`,
  });
  const b = confirmBooking(hold.bookingId);
  b.paidCents = 0; // settled at the shop
  persist();
  return b;
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

  const staffRows = effectiveStaff(shopId).map((st) => {
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
    return { staffId: st.id, name: st.name, role: st.role, tier: st.tier, locationId: st.locationId ?? null, shifts: st.shifts, working, blocks };
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
      logoUrl: getShopLogo(shop.id),
      services: effectiveServices(shop.id),
      pricingRules: effectiveRules(shop.id).map((r) => ({ ...r, enabled: !state.ruleDisabled.has(r.id) })),
      depositPercent: shop.depositPercent,
      policy: shop.policy,
      locations: shopLocations(shop.id),
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
      serviceIds: b.serviceIds,
      serviceNames: b.serviceIds.map((id) => serviceOf(shop, id)?.name.en ?? id),
      staffId: b.staffId,
      staffName: effectiveStaff(shopId).find((s) => s.id === b.staffId)?.name ?? '—',
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
  patch: { basePriceCents?: number; durationMin?: number; dynamicPricing?: boolean; categoryId?: string },
): void {
  const shop = shopById(shopId);
  if (!shop || !effectiveServices(shopId).some((s) => s.id === serviceId)) throw new Error('not_found');
  const current = state.serviceOverrides.get(serviceId) ?? {};
  state.serviceOverrides.set(serviceId, { ...current, ...patch });
  persist();
}

export function toggleRule(shopId: string, ruleId: string): boolean {
  const shop = shopById(shopId);
  if (!shop || !effectiveRules(shopId).some((r) => r.id === ruleId)) throw new Error('not_found');
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
  serviceIds: string[];
  staffName: string | null;
  review: { rating: number; text: string; date: string } | null;
  tipCents: number;
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
      serviceIds: b.serviceIds,
      staffName: shop ? effectiveStaff(shop.id).find((s) => s.id === b.staffId)?.name ?? null : null,
      review: b.review ?? null,
      tipCents: b.tipCents ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// vouchers & loyalty
// ---------------------------------------------------------------------------

export type VoucherResult =
  | { ok: true; voucher: Voucher; discountCents: number }
  | { ok: false; reason: 'unknown_code' | 'min_subtotal'; minSubtotalCents?: number };

export function validateVoucher(code: string, subtotalCents: number): VoucherResult {
  const voucher = VOUCHERS.find((v) => v.code === code.trim().toUpperCase());
  if (!voucher) return { ok: false, reason: 'unknown_code' };
  if (subtotalCents < voucher.minSubtotalCents) {
    return { ok: false, reason: 'min_subtotal', minSubtotalCents: voucher.minSubtotalCents };
  }
  const discountCents =
    voucher.kind === 'percent'
      ? Math.round((subtotalCents * voucher.value) / 100)
      : Math.min(voucher.value, subtotalCents);
  return { ok: true, voucher, discountCents };
}

/** 1 point per euro on completed visits (tips included); spending is recorded on the booking. */
export function loyaltyBalance(deviceId: string): number {
  let earned = 0;
  let spent = 0;
  for (const b of state.bookings.values()) {
    if (b.deviceId !== deviceId) continue;
    if (b.status === 'completed') {
      earned += Math.floor(((b.quote.totalCents + (b.tipCents ?? 0)) / 100) * LOYALTY_EARN_PER_EURO);
    }
    if (['hold', 'pending_payment', 'confirmed', 'completed'].includes(b.status)) {
      spent += b.pointsSpent ?? 0;
    }
  }
  return Math.max(earned - spent, 0);
}

// ---------------------------------------------------------------------------
// reviews & tips (stored on the booking → sync through Supabase for free)
// ---------------------------------------------------------------------------

export function setReview(bookingId: string, rating: number, text: string): Booking {
  const b = state.bookings.get(bookingId);
  if (!b) throw new Error('not_found');
  if (b.status !== 'completed') throw new Error('not_completed');
  b.review = { rating: Math.min(Math.max(Math.round(rating), 1), 5), text: text.slice(0, 500), date: isoDateOf(Date.now()) };
  persist();
  return b;
}

export function setTip(bookingId: string, tipCents: number): Booking {
  const b = state.bookings.get(bookingId);
  if (!b) throw new Error('not_found');
  if (b.status !== 'completed') throw new Error('not_completed');
  b.tipCents = Math.min(Math.max(Math.round(tipCents), 0), 50_000);
  persist();
  return b;
}

export interface UserReview {
  author: string;
  rating: number;
  text: string;
  date: string;
  serviceNames: Array<{ en: string; de: string }>;
}

export function userReviewsForShop(shopId: string): UserReview[] {
  const shop = shopById(shopId);
  const out: UserReview[] = [];
  for (const b of state.bookings.values()) {
    if (b.shopId !== shopId || !b.review) continue;
    out.push({
      author: b.guestName,
      rating: b.review.rating,
      text: b.review.text,
      date: b.review.date,
      serviceNames: b.serviceIds.map((id) => (shop ? serviceOf(shop, id)?.name : undefined) ?? { en: id, de: id }),
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ---------------------------------------------------------------------------
// waitlist (device-scoped)
// ---------------------------------------------------------------------------

export function joinWaitlist(deviceId: string, shopId: string, serviceIds: string[], isoDate: string): WaitlistEntry {
  const existing = [...state.waitlist.values()].find(
    (w) => w.deviceId === deviceId && w.shopId === shopId && w.isoDate === isoDate,
  );
  if (existing) return existing;
  const entry: WaitlistEntry = {
    id: `wl-${state.seq++}-${Date.now().toString(36)}`,
    deviceId,
    shopId,
    serviceIds,
    isoDate,
    createdAt: Date.now(),
  };
  state.waitlist.set(entry.id, entry);
  persist();
  return entry;
}

export function leaveWaitlist(id: string): void {
  state.waitlist.delete(id);
  persist();
}

export interface WaitlistView extends WaitlistEntry {
  shop: { slug: string; name: string; emoji: string } | null;
  serviceNames: Array<{ en: string; de: string }>;
}

// ---------------------------------------------------------------------------
// HR overview — one row per employee for a date range
// ---------------------------------------------------------------------------

export interface HrRow {
  staffId: string;
  name: string;
  role: { en: string; de: string };
  tier: 'senior' | 'stylist';
  email: string;
  phone: string;
  employedSince: string;
  weeklyHours: number;
  locationId: string | null;
  notes: string;
  absences: Absence[];
  /** minutes the person is actually rostered in the range (absences removed) */
  scheduledMin: number;
  /** minutes taken by confirmed/completed bookings */
  bookedMin: number;
  bookingCount: number;
  revenueCents: number;
  utilisationPct: number;
  absentDays: number;
}

export function hrOverview(shopId: string, fromIso: string, toIso: string): HrRow[] {
  const shop = shopById(shopId);
  if (!shop) return [];
  const rangeStart = dayStart(fromIso);
  const rangeEnd = dayStart(toIso) + 24 * 60 * MIN;

  // Every ISO date in the range, so rosters and absences are counted per day.
  const dates: string[] = [];
  for (let iso = fromIso; iso <= toIso; iso = addDays(iso, 1)) dates.push(iso);

  return effectiveStaff(shopId).map((st) => {
    let scheduledMin = 0;
    let absentDays = 0;
    for (const iso of dates) {
      if (isAbsent(st.id, iso)) {
        // Only count it as an absence day if the person would have worked.
        const dow = isoDow(dayStart(iso) + 12 * 60 * MIN);
        if ((st.shifts[dow] ?? []).length) absentDays += 1;
        continue;
      }
      for (const w of staffWindows(shop, st.id, iso)) scheduledMin += (w.end - w.start) / MIN;
    }

    let bookedMin = 0;
    let bookingCount = 0;
    let revenueCents = 0;
    for (const b of state.bookings.values()) {
      if (b.shopId !== shopId || b.staffId !== st.id) continue;
      if (!['confirmed', 'completed'].includes(b.status)) continue;
      if (b.startsAt < rangeStart || b.startsAt >= rangeEnd) continue;
      bookedMin += (b.endsAt - b.startsAt) / MIN;
      bookingCount += 1;
      revenueCents += b.quote.totalCents;
    }

    return {
      staffId: st.id,
      name: st.name,
      role: st.role,
      tier: st.tier,
      email: st.email ?? '',
      phone: st.phone ?? '',
      employedSince: st.employedSince ?? '',
      weeklyHours: st.weeklyHours ?? 0,
      locationId: st.locationId ?? null,
      notes: st.notes ?? '',
      absences: absencesFor(st.id),
      scheduledMin: Math.round(scheduledMin),
      bookedMin: Math.round(bookedMin),
      bookingCount,
      revenueCents,
      utilisationPct: scheduledMin > 0 ? Math.round((bookedMin / scheduledMin) * 100) : 0,
      absentDays,
    };
  });
}

// ---------------------------------------------------------------------------
// partner (shop) registration applications
// ---------------------------------------------------------------------------

export function submitShopApplication(deviceId: string, data: Record<string, unknown>): ShopApplication {
  const app: ShopApplication = {
    id: `app-${state.seq++}-${Date.now().toString(36)}`,
    deviceId,
    status: 'pending',
    data,
    createdAt: Date.now(),
  };
  state.applications.set(app.id, app);
  persist();
  return app;
}

export function applicationsForDevice(deviceId: string): ShopApplication[] {
  return [...state.applications.values()]
    .filter((a) => a.deviceId === deviceId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function waitlistForDevice(deviceId: string): WaitlistView[] {
  return [...state.waitlist.values()]
    .filter((w) => w.deviceId === deviceId)
    .sort((a, b) => (a.isoDate < b.isoDate ? -1 : 1))
    .map((w) => {
      const shop = shopById(w.shopId);
      return {
        ...w,
        shop: shop ? { slug: shop.slug, name: shop.name, emoji: shop.emoji } : null,
        serviceNames: w.serviceIds.map((id) => (shop ? serviceOf(shop, id)?.name : undefined) ?? { en: id, de: id }),
      };
    });
}
