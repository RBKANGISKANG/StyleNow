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

export type PaymentMethod = 'card' | 'paypal' | 'apple_pay' | 'google_pay' | 'sepa' | 'at_salon';

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
  /** money actually returned to the customer after a cancellation */
  refundedCents?: number;
  guestName: string;
  /** how the shop reaches this customer — optional, asked at checkout */
  guestPhone?: string;
  /** what the customer wants the shop to know (allergies, parking, …) */
  guestNote?: string;
  policySnapshot: { freeUntilHours: number; lateFeePercent: number; noShowFeePercent: number };
  cancellation?: { feeCents: number; refundCents: number; reason: string };
  review?: { rating: number; text: string; date: string };
  /** the shop's public answer to that review */
  reviewReply?: { text: string; at: string };
  tipCents?: number;
  pointsSpent?: number;
  voucherCode?: string;
  /** the part of the discount funded by a gift card — deducted from the card
   *  only when the booking confirms, never on a hold */
  giftCents?: number;
  /** How the online part was paid. Absent = settled at the salon. The label
   *  is presentation-safe ("Visa ····4242", "PayPal") — never a full PAN. */
  payment?: { method: PaymentMethod; label: string };
  /** A Prime flexible appointment: extra capacity the shop sells at a premium,
   *  at any time inside opening hours — it never occupies a seat in the grid. */
  isPrime?: boolean;
  /** Set when the customer moved it themselves — the shop's bell tells them. */
  movedAt?: number;
  movedFromStartsAt?: number;
  /** Set when the SHOP moved the time — the customer's bell tells them. */
  shopMovedAt?: number;
  /** Set when the shop handed the appointment to a different stylist. */
  reassignedAt?: number;
  /** Standing appointment: every booking in the series shares the first
   *  booking's id here, so the group is recognisable from any member. */
  seriesId?: string;
  createdAt: number;
}

export interface WaitlistEntry {
  id: string;
  deviceId: string;
  shopId: string;
  serviceIds: string[];
  isoDate: string;
  createdAt: number;
  /** The shop proposed this exact start; it lapses quietly after 30 minutes. */
  offer?: { startsAt: number; offeredAt: number; expiresAt: number };
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
  /** Absent = approved: entries the shop typed in predate requests and stand. */
  status?: 'pending' | 'approved';
  /** When the employee asked — set on requests, drives the shop's notice. */
  requestedAt?: number;
}

/** A day the whole shop is shut — public holiday, renovation, team offsite. */
export interface ShopClosure {
  id: string;
  shopId: string;
  from: string; // YYYY-MM-DD inclusive
  to: string;   // YYYY-MM-DD inclusive
  reason: string;
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
  shopPhotos: Map<string, ShopPhoto[]>; // shopId → gallery, first one is the cover
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
  closures: Map<string, ShopClosure[]>; // shopId → days the whole shop is shut
  customerNotes: Map<string, string>; // `${shopId}:${customerKey}` → private note
  messages: Map<string, Message[]>; // `${shopId}:${customerKey}` → the conversation
  billing: Map<string, BillingProfile>; // shopId → what its receipts must say
  giftCards: Map<string, GiftCard>; // code → the card (balance lives here)
  exitFeedback: ExitFeedback[]; // why people deleted an account or dropped a shop
  seq: number;
}

/**
 * A photo of the salon.
 *
 * Stored as a data URL because the demo has no object store; the uploader
 * downscales hard before it ever gets here (see lib/image.ts) precisely
 * because this ends up in localStorage next to everybody's bookings.
 */
export interface ShopPhoto {
  id: string;
  dataUrl: string;
  caption: string;
  addedAt: number;
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
    shopPhotos: new Map(),
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
    closures: new Map(),
    customerNotes: new Map(),
    messages: new Map(),
    billing: new Map(),
    giftCards: new Map(),
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

/**
 * Returns whether the write actually landed.
 *
 * Almost every caller can ignore this: losing a booking to a full disk is
 * already handled by the server transports, and in the local demo there is
 * nothing better to do than carry on in memory. Photos are the exception —
 * they are the first thing big enough to fill the quota on their own, and an
 * owner who uploads six pictures and finds them gone tomorrow deserved to be
 * told at upload time. So the failure is reported rather than swallowed, and
 * addShopPhoto below rolls back and says so.
 */
function persist(): boolean {
  stateVersion += 1;
  if (!persistenceEnabled) return true;
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
        shopPhotos: [...state.shopPhotos.entries()],
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
        closures: [...state.closures.entries()],
        customerNotes: [...state.customerNotes.entries()],
        messages: [...state.messages.entries()],
        billing: [...state.billing.entries()],
        giftCards: [...state.giftCards.entries()],
        exitFeedback: state.exitFeedback,
        seq: state.seq,
      }),
    );
    return true;
  } catch {
    // quota exceeded / private mode — demo keeps working in memory
    return false;
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
        shopPhotos?: Array<[string, ShopPhoto[]]>;
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
        closures?: Array<[string, ShopClosure[]]>;
        customerNotes?: Array<[string, string]>;
        messages?: Array<[string, Message[]]>;
        billing?: Array<[string, BillingProfile]>;
        giftCards?: Array<[string, GiftCard]>;
        exitFeedback?: ExitFeedback[];
        seq: number;
      };
      state.bookings = new Map(d.bookings.map((b) => [b.id, b]));
      state.ruleDisabled = new Set(d.ruleDisabled);
      state.serviceOverrides = new Map(d.serviceOverrides);
      state.waitlist = new Map((d.waitlist ?? []).map((w) => [w.id, w]));
      state.applications = new Map((d.applications ?? []).map((a) => [a.id, a]));
      state.shopLogos = new Map(d.shopLogos ?? []);
      state.shopPhotos = new Map(d.shopPhotos ?? []);
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
      state.closures = new Map(d.closures ?? []);
      state.customerNotes = new Map(d.customerNotes ?? []);
      state.messages = new Map(d.messages ?? []);
      state.billing = new Map(d.billing ?? []);
      state.giftCards = new Map(d.giftCards ?? []);
      state.exitFeedback = d.exitFeedback ?? [];
      state.seq = d.seq ?? state.bookings.size + 1;
    }
  } catch {
    // corrupted snapshot — start fresh
  }
}

// ---------------------------------------------------------------------------
// demo history
//
// A brand-new visitor used to land on a salon with a roster, a menu and no
// past: no customers, no reviews, no revenue, an empty waiting list, and a
// "next up" card with nobody in it. Every screen that summarises the business
// had nothing to summarise, which reads as broken rather than new.
//
// So a first visit gets six weeks of trading written in. It is deterministic —
// same seed, same salon, same history on every device — and it only ever runs
// when there is genuinely nothing stored, so it can never overwrite a real
// booking somebody made. Written straight into state rather than through
// createHold: this is fixture data, not traffic, and it must not consume
// idempotency keys or fight the seat contract for slots it is itself defining.
// ---------------------------------------------------------------------------

/**
 * The handful of regulars a salon actually knows by name, with the private
 * notes it keeps about them.
 */
const DEMO_REGULARS: Array<{ name: string; phone: string; note?: string }> = [
  { name: 'Marie Hoffmann', phone: '+49 170 555 0142', note: 'Colour 7.1, no ammonia. Prefers the window chair.' },
  { name: 'Sofia Brandt', phone: '+49 151 555 0198', note: 'Allergic to bleach — always patch test.' },
  { name: 'Nele Braun', phone: '+49 176 555 0477', note: 'Books 6-weekly, likes the 18:00 slot.' },
  { name: 'Amara Osei', phone: '+49 159 555 0844', note: 'Two no-shows — take a deposit.' },
  { name: 'Jonas Feld', phone: '+49 160 555 0311' },
  { name: 'Ida Roth', phone: '+49 152 555 0620' },
];

// Everyone else. Six weeks of trading is a few hundred visits, and most of them
// are people who came once — drawing every booking from a short list instead
// produced a customer book of ten people with twenty-six visits each, which is
// not a salon, it is a subscription.
const DEMO_FIRST = ['Lena', 'Tobias', 'Hanna', 'Ruben', 'Clara', 'Felix', 'Mila', 'Jonas', 'Emil', 'Greta',
  'Paul', 'Ayse', 'Noah', 'Leonie', 'Milan', 'Frida', 'Anton', 'Yara', 'Theo', 'Juna'];
const DEMO_LAST = ['Weber', 'Vogel', 'Kaiser', 'Lang', 'Schulz', 'Hartmann', 'Neumann', 'Beck', 'Sommer',
  'Winkler', 'Krause', 'Adler', 'Fuchs', 'Brandt', 'Reuter', 'Engel'];

const DEMO_REVIEWS: Array<{ rating: number; text: string }> = [
  { rating: 5, text: 'Understood exactly what I wanted — best balayage I have ever had.' },
  { rating: 5, text: 'Booked at 11:00, sat in the chair at 11:00. Great cut.' },
  { rating: 4, text: 'Lovely space, fair prices, and they never rush you.' },
  { rating: 5, text: 'Third time back. They remember how I like it, which saves the whole conversation.' },
  { rating: 3, text: 'Fine cut but I waited twenty minutes past my slot.' },
  { rating: 5, text: 'Walked out feeling like a different person. Worth every euro.' },
];

/** Fixture bookings for one shop, spread over the past twelve weeks and the next two. */
function seedDemoHistory(shop: SeedShop): void {
  const rand = mulberry32(hash(`demo:${shop.id}`));
  // Built once per shop and reused, so the same person can walk in twice.
  const pool = mulberry32(hash(`pool:${shop.id}`));
  const demoPool: Array<{ name: string; phone: string }> = Array.from({ length: 400 }, (_, i) => {
    const f = DEMO_FIRST[Math.floor(pool() * DEMO_FIRST.length)];
    const l = DEMO_LAST[Math.floor(pool() * DEMO_LAST.length)];
    const n = 1000 + Math.floor(pool() * 8999);
    return { name: `${f} ${l}`, phone: `+49 1${50 + (i % 40)} 555 ${n}` };
  });
  const team = effectiveStaff(shop.id);
  if (team.length === 0 || shop.services.length === 0) return;
  const today = todayIso();

  for (let d = -84; d <= 14; d++) {
    const iso = addDays(today, d);
    if (isShopClosed(shop.id, iso)) continue;
    const dow = isoDow(dayStart(iso));

    for (const staff of team) {
      const shifts = staff.shifts[dow] ?? [];
      if (shifts.length === 0) continue;
      // Busier as the day gets closer to today, thinner in the future — which
      // is what a real book looks like, and what makes "tomorrow is quiet"
      // mean something.
      const density = d < 0 ? 0.55 : d === 0 ? 0.5 : Math.max(0.32 - d * 0.02, 0.08);

      for (const w of shifts) {
        for (let min = w.startMin; min + 60 <= w.endMin; min += 90) {
          if (rand() > density) continue;
          const svc = shop.services[Math.floor(rand() * shop.services.length)];
          // Six in a hundred visits are one of the named regulars — enough for
          // them to come back every couple of weeks, not so many that the book
          // reads like a subscription. Everyone else is drawn from a fixed pool,
          // so repeat visits happen by coincidence the way they really do.
          const person = rand() < 0.06
            ? DEMO_REGULARS[Math.floor(rand() * DEMO_REGULARS.length)]
            : demoPool[Math.floor(rand() * demoPool.length)];
          const startsAt = dayStart(iso) + min * MIN;
          const durMs = (svc.durationMin + svc.processingGapMin + svc.finishMin) * MIN;
          const price = svc.basePriceCents;

          // Past days are settled: mostly completed, occasionally a no-show or
          // a cancellation, because a book with no friction in it is a fiction.
          const roll = rand();
          const status: BookingStatus =
            d >= 0 ? 'confirmed' : roll < 0.06 ? 'no_show' : roll < 0.11 ? 'cancelled_by_customer' : 'completed';
          if (status === 'cancelled_by_customer' && rand() < 0.5) continue;

          const id = `demo-${shop.id}-${iso}-${staff.id}-${min}`;
          const b: Booking = {
            id,
            reference: `DM-${(hash(id) % 90000 + 10000).toString(36).toUpperCase()}`,
            deviceId: `demo:${shop.id}`,
            shopId: shop.id,
            serviceIds: [svc.id],
            staffId: staff.id,
            startsAt,
            endsAt: startsAt + durMs,
            staffRanges: [{ start: startsAt, end: startsAt + durMs }],
            status,
            holdExpiresAt: null,
            quote: {
              subtotalCents: price,
              travelFeeCents: 0,
              discountCents: 0,
              vatCents: Math.round(price * 0.19),
              totalCents: price,
              depositCents: Math.round((price * shop.depositPercent) / 100),
              breakdown: [{ label: svc.name.en, cents: price }],
            },
            paidCents: status === 'completed' ? price : Math.round((price * shop.depositPercent) / 100),
            guestName: person.name,
            guestPhone: person.phone,
            policySnapshot: shop.policy,
            createdAt: startsAt - 3 * 24 * 60 * MIN,
          };

          // Roughly one completed visit in four leaves a review, which is about
          // what a salon really gets — enough to rate by, few enough that
          // "unanswered reviews" stays a short list worth acting on.
          if (status === 'completed' && rand() < 0.09) {
            const r = DEMO_REVIEWS[Math.floor(rand() * DEMO_REVIEWS.length)];
            b.review = { rating: r.rating, text: r.text, date: iso };
            if (rand() < 0.72) {
              b.reviewReply = { text: 'Thank you — see you next time.', at: addDays(iso, 1) };
            }
          }
          if (status === 'completed' && rand() < 0.3) b.tipCents = 200 + Math.floor(rand() * 6) * 100;

          state.bookings.set(id, b);
        }
      }
    }
  }

  // A few people waiting, so the briefing and the waiting list have something
  // real behind them.
  for (const [i, offset] of [1, 2, 4].entries()) {
    const svc = shop.services[i % shop.services.length];
    const id = `demo-wl-${shop.id}-${i}`;
    state.waitlist.set(id, {
      id,
      shopId: shop.id,
      serviceIds: [svc.id],
      isoDate: addDays(today, offset),
      deviceId: `demo:${shop.id}:${i}`,
      createdAt: Date.now() - (i + 1) * 24 * 60 * 60 * 1000,
    });
  }

  // And the private notes a shop builds up about its regulars.
  for (const person of DEMO_REGULARS) {
    if (!person.note) continue;
    state.customerNotes.set(`${shop.id}:p:${person.phone.replace(/[^0-9]/g, '').slice(-8)}`, person.note);
  }
}

/**
 * Only on a genuinely empty first visit. A returning visitor, a restored
 * snapshot, or a synced project all skip this — the demo history must never
 * appear on top of somebody's real book.
 */
export function seedDemoIfEmpty(): void {
  if (state.bookings.size > 0) return;
  for (const shop of SHOPS) seedDemoHistory(shop);
  persist();
}

/** Replace live state from an external source of truth (Supabase sync). */
// ---------------------------------------------------------------------------
// shop configuration as a syncable document
//
// Bookings are transactional and keep their real relational model in Postgres,
// guarded by the EXCLUDE constraint. Everything a shop *configures* — its team,
// branches, roster absences, closing days, own services and rules, customer
// notes — is a document that only that shop's operator edits. Syncing those as
// one JSON document per shop is honest about what they are, and it is what
// makes the back office work on more than one device: without it, a salon that
// adds a stylist on the desktop still sees the old team on the tablet.
// ---------------------------------------------------------------------------

export interface ShopConfig {
  owner?: string;
  staff?: StaffMember[];
  staffOverrides?: Array<[string, Partial<StaffMember>]>;
  archivedStaff?: string[];
  locations?: ShopLocation[];
  absences?: Array<[string, Absence[]]>;
  closures?: ShopClosure[];
  services?: SeedService[];
  archivedServices?: string[];
  rules?: PricingRule[];
  deletedRules?: string[];
  customerNotes?: Array<[string, string]>;
  photos?: ShopPhoto[];
  messages?: Array<[string, Message[]]>;
  billing?: BillingProfile;
}

/** Every staff id this shop knows about — seeded, added, or archived. */
function staffIdsOf(shopId: string): Set<string> {
  const shop = shopById(shopId);
  const ids = new Set<string>((shop?.staff ?? []).map((s) => s.id));
  for (const st of state.customStaff.get(shopId) ?? []) ids.add(st.id);
  return ids;
}

function serviceIdsOf(shopId: string): Set<string> {
  const shop = shopById(shopId);
  const ids = new Set<string>((shop?.services ?? []).map((s) => s.id));
  for (const sv of state.customServices.get(shopId) ?? []) ids.add(sv.id);
  return ids;
}

function ruleIdsOf(shopId: string): Set<string> {
  const shop = shopById(shopId);
  const ids = new Set<string>((shop?.pricingRules ?? []).map((r) => r.id));
  for (const r of state.customRules.get(shopId) ?? []) ids.add(r.id);
  return ids;
}

/** Slice this shop's configuration out of the global state. */
export function exportShopConfig(shopId: string): ShopConfig {
  const staffIds = staffIdsOf(shopId);
  const serviceIds = serviceIdsOf(shopId);
  const ruleIds = ruleIdsOf(shopId);
  return {
    owner: state.shopOwners.get(shopId),
    staff: state.customStaff.get(shopId) ?? [],
    staffOverrides: [...state.staffOverrides.entries()].filter(([id]) => staffIds.has(id)),
    archivedStaff: [...state.archivedStaff].filter((id) => staffIds.has(id)),
    locations: state.shopLocations.get(shopId) ?? [],
    absences: [...state.absences.entries()].filter(([id]) => staffIds.has(id)),
    closures: state.closures.get(shopId) ?? [],
    services: state.customServices.get(shopId) ?? [],
    archivedServices: [...state.archivedServices].filter((id) => serviceIds.has(id)),
    rules: state.customRules.get(shopId) ?? [],
    deletedRules: [...state.deletedRules].filter((id) => ruleIds.has(id)),
    customerNotes: [...state.customerNotes.entries()].filter(([k]) => k.startsWith(`${shopId}:`)),
    photos: state.shopPhotos.get(shopId) ?? [],
    messages: [...state.messages.entries()].filter(([k]) => k.startsWith(`${shopId}:`)),
    billing: state.billing.get(shopId),
  };
}

/**
 * Merge a synced document back in, replacing only this shop's slice. Another
 * shop's configuration in the same maps is left alone, so two salons syncing
 * against the same project never overwrite each other.
 */
export function applyShopConfig(shopId: string, doc: ShopConfig): void {
  const staffIds = staffIdsOf(shopId);
  const serviceIds = serviceIdsOf(shopId);
  const ruleIds = ruleIdsOf(shopId);

  if (doc.owner) state.shopOwners.set(shopId, doc.owner);
  else state.shopOwners.delete(shopId);

  if (doc.staff) state.customStaff.set(shopId, doc.staff);
  if (doc.locations) state.shopLocations.set(shopId, doc.locations);
  if (doc.closures) state.closures.set(shopId, doc.closures);
  if (doc.services) state.customServices.set(shopId, doc.services);
  if (doc.rules) state.customRules.set(shopId, doc.rules);
  if (doc.photos) state.shopPhotos.set(shopId, doc.photos);
  if (doc.billing) state.billing.set(shopId, doc.billing);

  // Re-derive the ids this shop owns *after* its custom lists landed, so a
  // stylist created on another device is recognised as ours.
  const nextStaffIds = staffIdsOf(shopId);

  if (doc.staffOverrides) {
    for (const [id] of state.staffOverrides) if (staffIds.has(id) || nextStaffIds.has(id)) state.staffOverrides.delete(id);
    for (const [id, patch] of doc.staffOverrides) state.staffOverrides.set(id, patch);
  }
  if (doc.archivedStaff) {
    for (const id of [...state.archivedStaff]) if (staffIds.has(id) || nextStaffIds.has(id)) state.archivedStaff.delete(id);
    for (const id of doc.archivedStaff) state.archivedStaff.add(id);
  }
  if (doc.absences) {
    for (const [id] of state.absences) if (staffIds.has(id) || nextStaffIds.has(id)) state.absences.delete(id);
    for (const [id, list] of doc.absences) state.absences.set(id, list);
  }
  if (doc.archivedServices) {
    const next = serviceIdsOf(shopId);
    for (const id of [...state.archivedServices]) if (serviceIds.has(id) || next.has(id)) state.archivedServices.delete(id);
    for (const id of doc.archivedServices) state.archivedServices.add(id);
  }
  if (doc.deletedRules) {
    const next = ruleIdsOf(shopId);
    for (const id of [...state.deletedRules]) if (ruleIds.has(id) || next.has(id)) state.deletedRules.delete(id);
    for (const id of doc.deletedRules) state.deletedRules.add(id);
  }
  if (doc.customerNotes) {
    for (const k of [...state.customerNotes.keys()]) if (k.startsWith(`${shopId}:`)) state.customerNotes.delete(k);
    for (const [k, v] of doc.customerNotes) state.customerNotes.set(k, v);
  }

  // Conversations merge by message id rather than replace: the customer writes
  // from their own device and the shop from theirs, so a wholesale overwrite
  // would drop whichever side had not synced yet.
  if (doc.messages) {
    for (const [k, incoming] of doc.messages) {
      const have = state.messages.get(k) ?? [];
      const byId = new Map(have.map((m) => [m.id, m]));
      for (const m of incoming) {
        const mine = byId.get(m.id);
        // Later of the two read stamps wins — read is a fact, not an opinion.
        byId.set(m.id, mine ? { ...m, readAt: Math.max(mine.readAt ?? 0, m.readAt ?? 0) || null } : m);
      }
      state.messages.set(k, [...byId.values()].sort((a, b) => a.at - b.at));
    }
  }

  stateVersion += 1;
}

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

// --- photos of the salon ---------------------------------------------------

/**
 * Six is the cap, and it is not arbitrary.
 *
 * Every photo lives in the same localStorage record as every booking, so an
 * unbounded gallery is a way to lose the shop's diary. Six also happens to be
 * about as many pictures as anybody looks at before deciding — past that a
 * gallery is a slideshow nobody finishes.
 */
export const MAX_SHOP_PHOTOS = 6;

/** Thrown when the browser refused to store the picture. */
export class PhotoStorageFull extends Error {
  constructor() {
    super('photo_storage_full');
    this.name = 'PhotoStorageFull';
  }
}

export function shopPhotos(shopId: string): ShopPhoto[] {
  return state.shopPhotos.get(shopId) ?? [];
}

/** The picture that represents the shop in the feed and at the top of its page. */
export function shopCover(shopId: string): string | null {
  return state.shopPhotos.get(shopId)?.[0]?.dataUrl ?? null;
}

export function addShopPhoto(shopId: string, dataUrl: string, caption = ''): ShopPhoto {
  const before = shopPhotos(shopId);
  if (before.length >= MAX_SHOP_PHOTOS) throw new Error('photo_limit');
  const photo: ShopPhoto = {
    id: `ph-${state.seq++}-${Date.now().toString(36)}`,
    dataUrl,
    caption: caption.trim().slice(0, 90),
    addedAt: Date.now(),
  };
  state.shopPhotos.set(shopId, [...before, photo]);
  if (!persist()) {
    // Put the gallery back the way it was: a photo that is only in memory
    // would vanish on the next reload with no explanation.
    state.shopPhotos.set(shopId, before);
    persist();
    throw new PhotoStorageFull();
  }
  return photo;
}

export function removeShopPhoto(shopId: string, photoId: string): void {
  state.shopPhotos.set(shopId, shopPhotos(shopId).filter((p) => p.id !== photoId));
  persist();
}

/** Promote a photo to the front — the front one is the cover, everywhere. */
export function makeShopCover(shopId: string, photoId: string): void {
  const list = shopPhotos(shopId);
  const hit = list.find((p) => p.id === photoId);
  if (!hit) return;
  state.shopPhotos.set(shopId, [hit, ...list.filter((p) => p.id !== photoId)]);
  persist();
}

export function captionShopPhoto(shopId: string, photoId: string, caption: string): void {
  state.shopPhotos.set(
    shopId,
    shopPhotos(shopId).map((p) => (p.id === photoId ? { ...p, caption: caption.trim().slice(0, 90) } : p)),
  );
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
  // Archiving somebody with booked customers would orphan those appointments
  // silently. The dashboard resolves them first (reassign or cancel & refund).
  if (bookingConflicts(shopId, { staffId }).length > 0) throw new Error('has_bookings');
  state.archivedStaff.add(staffId);
  persist();
}

/**
 * The bookings a personnel decision would strand.
 *
 * Approving a vacation, adding a closure or archiving a stylist all remove
 * working windows — but the appointments already sold inside those windows do
 * not disappear with them. This lists every live future booking the decision
 * touches, and for a per-stylist question also says which colleagues could
 * take each appointment exactly as it stands (same day, same time, same
 * services), so the front desk can resolve with one tap per row instead of a
 * phone call per customer.
 */
export interface BookingConflict {
  bookingId: string;
  reference: string;
  startsAt: number;
  endsAt: number;
  guestName: string;
  serviceNames: Array<{ en: string; de: string }>;
  staffId: string;
  staffName: string;
  totalCents: number;
  candidates: Array<{ id: string; name: string }>;
}

export function bookingConflicts(
  shopId: string,
  opts: { staffId?: string | null; fromIso?: string; toIso?: string } = {},
): BookingConflict[] {
  const shop = shopById(shopId);
  if (!shop) return [];
  const now = Date.now();
  const team = effectiveStaff(shopId);
  const out: BookingConflict[] = [];

  for (const b of state.bookings.values()) {
    if (b.shopId !== shopId || b.startsAt <= now) continue;
    if (!['confirmed', 'pending_payment'].includes(b.status)) continue;
    if (b.status === 'pending_payment' && (b.holdExpiresAt ?? 0) < now) continue; // dead hold
    // Prime bookings hold no seat, so no stylist's absence can strand them.
    if (b.isPrime) continue;
    if (opts.staffId && b.staffId !== opts.staffId) continue;
    const iso = isoDateOf(b.startsAt);
    if (opts.fromIso && iso < opts.fromIso) continue;
    if (opts.toIso && iso > opts.toIso) continue;

    const services = b.serviceIds
      .map((id) => serviceOf(shop, id))
      .filter((x): x is SeedService => Boolean(x));
    const timing = aggregate(services);
    const held = occupancyForBasket(b.startsAt, services, shop.rules);

    // Colleagues only make sense for a per-stylist question; a shop-wide
    // closure shuts everyone, so there is nobody left to hand the visit to.
    const candidates: Array<{ id: string; name: string }> = [];
    if (opts.staffId) {
      for (const st of team) {
        if (st.id === b.staffId) continue;
        const day = staffDayOf(shop, st.id, iso, now);
        const fits = day.working.some(
          (w) => b.startsAt >= w.start && b.startsAt + timing.durationMin * MIN <= w.end,
        );
        if (fits && !held.some((h) => day.busy.some((x) => overlaps(h, x)))) {
          candidates.push({ id: st.id, name: st.name });
        }
      }
    }

    out.push({
      bookingId: b.id,
      reference: b.reference,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      guestName: b.guestName,
      serviceNames: b.serviceIds.map((id) => serviceOf(shop, id)?.name ?? { en: id, de: id }),
      staffId: b.staffId,
      staffName: team.find((s) => s.id === b.staffId)?.name ?? '—',
      totalCents: b.quote.totalCents,
      candidates,
    });
  }

  return out.sort((a, b) => a.startsAt - b.startsAt);
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
  // A pending request is a question, not a fact: the roster keeps selling the
  // day until somebody who runs the shop says yes.
  return (state.absences.get(staffId) ?? []).some(
    (a) => a.status !== 'pending' && isoDate >= a.from && isoDate <= a.to,
  );
}

export function addAbsence(staffId: string, input: Omit<Absence, 'id' | 'staffId'>): Absence {
  const absence: Absence = { ...input, id: `abs-${state.seq++}-${Date.now().toString(36)}`, staffId };
  state.absences.set(staffId, [...(state.absences.get(staffId) ?? []), absence]);
  persist();
  return absence;
}

/**
 * An employee asks for days off from their own view. It lands as a pending
 * entry on the same absence list the shop already manages — one list, two
 * doors — and blocks nothing until it is approved.
 */
export function requestAbsence(staffId: string, input: Omit<Absence, 'id' | 'staffId' | 'status' | 'requestedAt'>): Absence {
  const absence: Absence = {
    ...input,
    id: `abs-${state.seq++}-${Date.now().toString(36)}`,
    staffId,
    status: 'pending',
    requestedAt: Date.now(),
  };
  state.absences.set(staffId, [...(state.absences.get(staffId) ?? []), absence]);
  persist();
  return absence;
}

export function approveAbsence(staffId: string, absenceId: string): void {
  state.absences.set(
    staffId,
    (state.absences.get(staffId) ?? []).map((a) => (a.id === absenceId ? { ...a, status: 'approved' as const } : a)),
  );
  persist();
}

/** Shop-wide closures: one entry shuts every stylist for those dates. */
export function shopClosures(shopId: string): ShopClosure[] {
  return [...(state.closures.get(shopId) ?? [])].sort((a, b) => a.from.localeCompare(b.from));
}

export function isShopClosed(shopId: string, isoDate: string): boolean {
  return (state.closures.get(shopId) ?? []).some((c) => isoDate >= c.from && isoDate <= c.to);
}

export function addClosure(shopId: string, input: Omit<ShopClosure, 'id' | 'shopId'>): ShopClosure {
  const closure: ShopClosure = { ...input, id: `cls-${state.seq++}-${Date.now().toString(36)}`, shopId };
  state.closures.set(shopId, [...(state.closures.get(shopId) ?? []), closure]);
  persist();
  return closure;
}

export function deleteClosure(shopId: string, closureId: string): void {
  state.closures.set(shopId, (state.closures.get(shopId) ?? []).filter((c) => c.id !== closureId));
  persist();
}

export function deleteAbsence(staffId: string, absenceId: string): void {
  state.absences.set(staffId, (state.absences.get(staffId) ?? []).filter((a) => a.id !== absenceId));
  persist();
}

// ---------------------------------------------------------------------------
// opening hours — what a shop's own page needs to say about itself
// ---------------------------------------------------------------------------

export interface OpeningWindow {
  startMin: number;
  endMin: number;
}

export interface OpeningDay {
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  dow: number;
  /** Empty means shut that day. */
  windows: OpeningWindow[];
}

/** Merge overlapping or touching windows so two stylists don't read as two shifts. */
function mergeWindows(ws: OpeningWindow[]): OpeningWindow[] {
  const out: OpeningWindow[] = [];
  for (const w of [...ws].sort((a, b) => a.startMin - b.startMin)) {
    const last = out[out.length - 1];
    if (last && w.startMin <= last.endMin) last.endMin = Math.max(last.endMin, w.endMin);
    else out.push({ ...w });
  }
  return out;
}

/**
 * When the shop is open, Monday first.
 *
 * A salon has no opening hours of its own — it is open when somebody is
 * standing behind a chair. Deriving them from the roster keeps the public page
 * honest for free: hire a Saturday stylist and Saturday appears, with no second
 * place for the owner to remember to update.
 */
export function openingHours(shopId: string): OpeningDay[] {
  const byDow = new Map<number, OpeningWindow[]>();
  for (const st of effectiveStaff(shopId)) {
    for (const [key, windows] of Object.entries(st.shifts)) {
      const list = byDow.get(Number(key)) ?? [];
      for (const w of windows ?? []) list.push({ startMin: w.startMin, endMin: w.endMin });
      byDow.set(Number(key), list);
    }
  }
  return [1, 2, 3, 4, 5, 6, 7].map((dow) => ({ dow, windows: mergeWindows(byDow.get(dow) ?? []) }));
}

// --- Prime flexible appointments -------------------------------------------

/**
 * Prime is a product, not a price tag: an *extra* appointment sold on top of
 * the calendar, at any time inside opening hours, for the customer who will
 * pay more to be fitted in. It never occupies a seat — the grid stays exactly
 * as bookable as before, and the shop absorbs the squeeze (that is what the
 * premium buys). Which is also why it carries no staff conflict check: there
 * is nothing to conflict with, because it holds no seat.
 */
export const PRIME_PERCENT = 30;
export const PRIME_MIN_CENTS = 1500;

export class PrimeUnavailable extends Error {
  constructor(reason: 'closed' | 'past') {
    super(reason);
    this.name = 'PrimeUnavailable';
  }
}

/**
 * When Prime can be booked on a date: the shop's opening windows, empty when a
 * closure shuts the whole day. The UI turns these into 15-minute steps.
 */
export function primeWindowsFor(shopId: string, iso: string): OpeningWindow[] {
  if (isShopClosed(shopId, iso)) return [];
  return openingHours(shopId).find((h) => h.dow === isoDow(dayStart(iso)))?.windows ?? [];
}

/** The premium on a basket subtotal, in cents. */
export function primeSurcharge(subtotalCents: number): number {
  return Math.max(Math.round((subtotalCents * PRIME_PERCENT) / 100), PRIME_MIN_CENTS);
}

export interface ShopStatus {
  open: boolean;
  /** Minute of day the doors shut — only when open right now. */
  closesAtMin: number | null;
  /** The next day and time it opens — only when shut. */
  nextOpenIso: string | null;
  nextOpenMin: number | null;
  /** Set when today falls inside a holiday closure, so the page can say why. */
  closedReason: string | null;
}

/** Open or shut this minute, and when that changes. */
export function shopStatus(shopId: string, now = Date.now()): ShopStatus {
  const hours = openingHours(shopId);
  const windowsOn = (iso: string): OpeningWindow[] =>
    isShopClosed(shopId, iso) ? [] : hours.find((h) => h.dow === isoDow(dayStart(iso)))?.windows ?? [];

  const today = isoDateOf(now);
  const nowMin = minuteOfDay(now);
  const shut = { open: false as const, closesAtMin: null };

  const openNow = windowsOn(today).find((w) => nowMin >= w.startMin && nowMin < w.endMin);
  if (openNow) {
    return { open: true, closesAtMin: openNow.endMin, nextOpenIso: null, nextOpenMin: null, closedReason: null };
  }

  const reason =
    (state.closures.get(shopId) ?? []).find((c) => today >= c.from && today <= c.to)?.reason ?? null;

  // Later today first, then forward. Two weeks is long enough to cover a
  // Christmas break; past that "we'll be back" is more honest than a date.
  for (let d = 0; d < 14; d++) {
    const iso = addDays(today, d);
    const next = windowsOn(iso).find((w) => d > 0 || w.startMin > nowMin);
    if (next) return { ...shut, nextOpenIso: iso, nextOpenMin: next.startMin, closedReason: reason };
  }
  return { ...shut, nextOpenIso: null, nextOpenMin: null, closedReason: reason };
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
  if (isShopClosed(shop.id, isoDate)) return []; // whole shop shut that day
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
  opts: { backfill?: boolean } = {},
): { slots: ApiSlot[]; timing: ServiceTiming } {
  const shop = shopById(shopId);
  if (!shop) throw new Error('shop_not_found');
  const services = serviceIds
    .map((id) => serviceOf(shop, id))
    .filter((s): s is SeedService => Boolean(s));
  if (services.length === 0) throw new Error('service_not_found');

  const now = Date.now();
  /**
   * Slot projection refuses anything before `now + lead`, which is right for a
   * customer — you cannot book the past — and wrong for the shop. A salon has
   * to record the walk-in who came in at eleven this morning, and to backfill
   * yesterday when the till was too busy. Backfill therefore projects the day
   * as if the clock stood at its opening minute, which reopens that day's
   * rostered times. Everything protective is untouched: `staffDayOf` still runs
   * on the real clock, so live holds expire correctly, and the busy-overlap
   * check still refuses a time somebody already occupies. Backfilling cannot
   * double-book.
   */
  const projectFrom = opts.backfill ? Math.min(now, dayStart(isoDate)) : now;
  const timing = aggregate(services);
  const team = effectiveStaff(shopId);
  const staffPool = staffId ? team.filter((s) => s.id === staffId) : team;

  const loadByStaff: Record<string, number> = {};
  const perStaff = staffPool.flatMap((st) => {
    const day = staffDayOf(shop, st.id, isoDate, now);
    loadByStaff[st.id] = day.busy.length;
    return slotsForStaff(day, timing, shop.rules, projectFrom);
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

export interface Opening {
  iso: string;
  start: number;
  end: number;
  priceCents: number;
  staffId: string;
}

/**
 * The next few genuinely bookable times, for the shop's own page.
 *
 * Deliberately not "the next N slots": a shop with an empty Tuesday would
 * answer 14:00, 14:15, 14:30 … which tells a customer nothing they can choose
 * between. Spreading the picks across the day and across days answers the
 * question people actually have — *can I get in tonight, and if not, when?*
 */
export function nextOpenings(
  shopId: string,
  serviceIds: string[],
  deviceId: string,
  opts: { limit?: number; horizonDays?: number; perDay?: number; spreadMin?: number } = {},
): Opening[] {
  const { limit = 6, horizonDays = 14, perDay = 2, spreadMin = 180 } = opts;
  const now = Date.now();
  const out: Opening[] = [];

  for (let d = 0; d < horizonDays && out.length < limit; d++) {
    const iso = addDays(isoDateOf(now), d);
    let slots: ApiSlot[];
    try {
      slots = availability(shopId, serviceIds, iso, deviceId).slots;
    } catch {
      return out; // service archived mid-flight — better a short list than none
    }

    let takenToday = 0;
    let lastStart = -Infinity;
    for (const s of slots) {
      if (takenToday >= perDay || out.length >= limit) break;
      if (s.start <= now || s.start - lastStart < spreadMin * MIN) continue;
      out.push({ iso, start: s.start, end: s.end, priceCents: s.priceCents, staffId: s.suggestedStaffId });
      lastStart = s.start;
      takenToday += 1;
    }
  }
  return out;
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
  /** Where it is — the map view places pins from these. */
  lat: number;
  lng: number;
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
  /** The shop's own cover photo, if it has uploaded one. */
  coverUrl: string | null;
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
      lat: s.lat,
      lng: s.lng,
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
      coverUrl: shopCover(s.id),
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
  guestPhone?: string;
  guestNote?: string;
  voucherCode?: string;
  pointsToSpend?: number;
  /** Book as a Prime flexible appointment — see primeWindowsFor(). */
  prime?: boolean;
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
  // A start in the past can only come from the shop recording something after
  // the fact; project the day the same way here, or resolving the stylist and
  // listing alternatives both come back empty.
  const past = { backfill: input.startsAt < now };

  // Resolve staff: requested, or the least-loaded member free at this time.
  let staffId = input.staffId ?? null;

  if (input.prime) {
    // Prime skips the seat check entirely — it is extra capacity, not a slot.
    // What it must NOT skip: the doors. A Prime booking outside opening hours
    // would be selling flexibility the shop does not have.
    if (input.startsAt <= now) throw new PrimeUnavailable('past');
    const startMin = minuteOfDay(input.startsAt);
    const endMin = startMin + timing.durationMin;
    const inHours = primeWindowsFor(input.shopId, isoDate).some(
      (w) => startMin >= w.startMin && endMin <= w.endMin,
    );
    if (!inHours) throw new PrimeUnavailable('closed');
    // Whoever carries the day gets the squeeze: the rostered member with the
    // fewest bookings, or the customer's preferred stylist if they named one.
    if (!staffId) {
      const dow = isoDow(dayStart(isoDate));
      const rostered = effectiveStaff(input.shopId).filter((st) => (st.shifts[dow] ?? []).length > 0);
      const load = (id: string): number =>
        [...state.bookings.values()].filter(
          (b) => b.staffId === id && isoDateOf(b.startsAt) === isoDate && bookingBlocks(b, now),
        ).length;
      staffId = rostered.sort((a, b) => load(a.id) - load(b.id))[0]?.id ?? null;
      if (!staffId) throw new PrimeUnavailable('closed');
    }
  } else {
    if (!staffId) {
      const { slots } = availability(input.shopId, input.serviceIds, isoDate, input.deviceId, null, past);
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
      const { slots } = availability(input.shopId, input.serviceIds, isoDate, input.deviceId, null, past);
      const alternatives = slots
        .filter((s) => s.start !== input.startsAt)
        .sort((a, b) => Math.abs(a.start - input.startsAt) - Math.abs(b.start - input.startsAt))
        .slice(0, 6)
        .sort((a, b) => a.start - b.start);
      throw new SlotTaken(alternatives);
    }
  }

  const tier = effectiveStaff(input.shopId).find((s) => s.id === staffId)?.tier ?? 'stylist';
  const q = priceBasket(shop, services, input.startsAt, now, input.deviceId, tier);
  const travelFeeCents = shop.isMobile ? 1500 : 0;
  const primeCents = input.prime ? primeSurcharge(q.subtotalCents) : 0;

  // Discounts: voucher first, then loyalty points on the remainder.
  let discountCents = 0;
  let giftCents = 0;
  const discountLines: Array<{ label: string; cents: number }> = [];
  if (input.voucherCode) {
    const v = validateVoucher(input.voucherCode, q.subtotalCents);
    if (!v.ok) throw new Error('voucher_invalid');
    discountCents += v.discountCents;
    const isGift = v.giftBalanceCents !== undefined;
    if (isGift) giftCents = v.discountCents;
    discountLines.push({ label: `${isGift ? 'Gift card' : 'Voucher'} ${v.voucher.code}`, cents: -v.discountCents });
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

  const totalCents = Math.max(q.subtotalCents + primeCents + travelFeeCents - discountCents, 0);
  const vatCents = services.reduce((sum, s) => {
    const share = q.subtotalCents === 0 ? 0 : s.basePriceCents / q.baseCents;
    // The Prime premium is part of the service's consideration, so it carries
    // the same VAT as the services it rides on.
    const line = Math.round((q.subtotalCents + primeCents) * share);
    return sum + Math.round((line * s.vatRateBps) / (10_000 + s.vatRateBps));
  }, 0);
  const depositCents = Math.round((totalCents * shop.depositPercent) / 100);

  const breakdown: Array<{ label: string; cents: number }> = services.map((s) => ({
    label: s.name.en,
    cents: s.basePriceCents,
  }));
  for (const a of q.applied) if (a.deltaCents !== 0) breakdown.push({ label: a.name, cents: a.deltaCents });
  if (primeCents) breakdown.push({ label: `Prime flexible +${PRIME_PERCENT}%`, cents: primeCents });
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
    // Prime holds no seat — an empty range list keeps it invisible to the
    // availability projection, which is the entire point of the product.
    staffRanges: input.prime ? [] : occupancyForBasket(input.startsAt, services, shop.rules),
    status: 'pending_payment',
    holdExpiresAt: now + HOLD_TTL_SECONDS * 1000,
    quote: { subtotalCents: q.subtotalCents, travelFeeCents, discountCents, vatCents, totalCents, depositCents, breakdown },
    paidCents: 0,
    guestName: input.guestName,
    guestPhone: input.guestPhone?.trim() || undefined,
    guestNote: input.guestNote?.trim() || undefined,
    pointsSpent: pointsSpent || undefined,
    voucherCode: input.voucherCode || undefined,
    giftCents: giftCents || undefined,
    isPrime: input.prime || undefined,
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

export function confirmBooking(id: string, payment?: { method: PaymentMethod; label: string }): Booking {
  const b = state.bookings.get(id);
  if (!b) throw new Error('not_found');
  if (b.status === 'confirmed') return b;
  if (b.status !== 'hold' && b.status !== 'pending_payment') throw new HoldExpired();
  if (b.holdExpiresAt && b.holdExpiresAt < Date.now()) throw new HoldExpired();
  b.status = 'confirmed';
  b.holdExpiresAt = null;
  b.paidCents = b.quote.depositCents > 0 ? b.quote.depositCents : b.quote.totalCents;
  if (payment) b.payment = payment;
  redeemGiftCard(b); // the moment the promise is real, the card pays its share
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
    // Settle the money, don't just calculate it. The refund leaves the shop's
    // books; what stays behind is the fee. Without this the booking kept
    // showing the deposit as paid and the customer never got it back.
    b.refundedCents = (b.refundedCents ?? 0) + outcome.refundCents;
    b.paidCents = Math.max(b.paidCents - outcome.refundCents, 0);
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
  /**
   * Set when the *customer* is doing the moving. Two extra rules apply that
   * the front desk is not bound by: it must be their own booking, and it must
   * still be inside the free-cancellation window — otherwise moving would be
   * a way to dodge the late fee the policy exists to charge.
   */
  opts: { byDevice?: string } = {},
): Booking {
  const b = state.bookings.get(bookingId);
  if (!b || b.shopId !== shopId) throw new Error('not_found');
  if (!['confirmed', 'pending_payment'].includes(b.status)) throw new Error('not_movable');
  if (opts.byDevice) {
    if (b.deviceId !== opts.byDevice) throw new Error('not_yours');
    if (Date.now() > b.startsAt - b.policySnapshot.freeUntilHours * 36e5) throw new Error('too_late');
  }
  const movedFrom = b.startsAt;
  const shop = shopById(shopId);
  if (!shop) throw new Error('shop_not_found');
  const services = b.serviceIds
    .map((id) => serviceOf(shop, id))
    .filter((x): x is SeedService => Boolean(x));
  const timing = aggregate(services);
  const staffId = newStaffId ?? b.staffId;
  const now = Date.now();
  const isoDate = isoDateOf(newStartsAt);

  // A Prime booking holds no seat, so moving it needs no seat either — only
  // the doors matter, same rule as when it was sold.
  if (b.isPrime) {
    const startMin = minuteOfDay(newStartsAt);
    const okHours = primeWindowsFor(shopId, isoDate).some(
      (w) => startMin >= w.startMin && startMin + timing.durationMin <= w.endMin,
    );
    if (!okHours) throw new PrimeUnavailable('closed');
  } else {
    const day = staffDayOf(shop, staffId, isoDate, now, b.id);
    const held = occupancyForBasket(newStartsAt, services, shop.rules);
    const inWindow = day.working.some(
      (w) => newStartsAt >= w.start && newStartsAt + timing.durationMin * MIN <= w.end,
    );
    if (!inWindow || held.some((h) => day.busy.some((x) => overlaps(h, x)))) {
      const { slots } = availability(shopId, b.serviceIds, isoDate, b.deviceId, newStaffId ?? null);
      throw new SlotTaken(slots.slice(0, 6));
    }
    b.staffRanges = held;
  }

  const prevStaffId = b.staffId;
  b.staffId = staffId;
  b.startsAt = newStartsAt;
  b.endsAt = newStartsAt + (timing.durationMin + timing.processingGapMin + timing.finishMin) * MIN;
  if (opts.byDevice) {
    b.movedAt = Date.now();
    b.movedFromStartsAt = movedFrom;
  } else {
    // The front desk did this — the customer deserves to hear about it, the
    // mirror image of the shop hearing about customer moves.
    if (newStartsAt !== movedFrom) {
      b.shopMovedAt = Date.now();
      b.movedFromStartsAt = movedFrom;
    }
    if (staffId !== prevStaffId) b.reassignedAt = Date.now();
  }
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
  contact?: { phone?: string; note?: string },
): Booking {
  const hold = createHold({
    shopId,
    serviceIds,
    staffId,
    startsAt,
    deviceId: `shop:${shopId}`,
    guestName,
    guestPhone: contact?.phone,
    guestNote: contact?.note,
    idempotencyKey: `shopbk-${shopId}-${startsAt}-${state.seq}`,
  });
  const b = confirmBooking(hold.bookingId);
  b.paidCents = 0; // settled at the shop
  // Something recorded after the fact already happened; leaving it "confirmed"
  // would put a past appointment back on the list of things still to come.
  if (startsAt < Date.now()) b.status = 'completed';
  persist();
  return b;
}

/**
 * A standing appointment: the same time, the same stylist, every N weeks.
 *
 * The regular is the salon's whole economics and the customer's whole habit,
 * yet every platform makes them re-book from scratch each visit. This books
 * the next occurrences in one gesture — each one through the same
 * hold-and-confirm path as any booking, so the no-double-booking contract
 * holds for every member of the series.
 *
 * Dates where the slot is already taken are SKIPPED and reported, not
 * silently shifted: "your usual Tuesday 14:00 is full on 6 Oct" is
 * information the customer must see, and quietly booking 15:30 instead is
 * how a standing appointment loses its meaning. Payment for future members
 * is settled at the salon — the platform holds seats, not months of money.
 */
export function bookSeries(
  deviceId: string,
  bookingId: string,
  everyWeeks: number,
  count: number,
): { booked: Booking[]; skippedDates: number[] } {
  const b = state.bookings.get(bookingId);
  if (!b || b.deviceId !== deviceId) throw new Error('not_yours');
  if (!['confirmed', 'pending_payment'].includes(b.status)) throw new Error('not_bookable');
  if (b.isPrime) throw new Error('prime_series'); // prime is flexible capacity, a series follows the grid
  if (![1, 2, 3, 4, 6, 8].includes(everyWeeks) || count < 1 || count > 12) throw new Error('bad_series');

  const booked: Booking[] = [];
  const skippedDates: number[] = [];
  // "Same time in N weeks" means the same Berlin wall clock, not the same UTC
  // instant — adding fixed milliseconds would slide every visit after a DST
  // switch by an hour, off the roster grid the original seat sits on.
  const baseIso = isoDateOf(b.startsAt);
  const minutes = minuteOfDay(b.startsAt);
  for (let k = 1; k <= count; k++) {
    const target = dayStart(addDays(baseIso, everyWeeks * 7 * k)) + minutes * 60_000;
    // Rerunning the same series must not double it: a member already holding
    // this exact seat counts as done, not as a new booking.
    const dup = [...state.bookings.values()].some(
      (x) => x.seriesId === bookingId && x.startsAt === target && !x.status.startsWith('cancelled'),
    );
    if (dup) {
      skippedDates.push(target);
      continue;
    }
    try {
      // createHold is the seat authority: roster window + no overlap. The
      // browsing slot list deliberately thins free times to shape demand, and
      // a standing appointment must not be refused by merchandising — nor by
      // the public booking horizon: reserving beyond it is exactly the
      // privilege a regular's series has over a walk-up browser.
      const hold = createHold({
        shopId: b.shopId,
        serviceIds: b.serviceIds,
        staffId: b.staffId,
        startsAt: target,
        deviceId,
        guestName: b.guestName,
        guestPhone: b.guestPhone,
        guestNote: b.guestNote,
        idempotencyKey: `series-${bookingId}-${k}-${target}`,
      });
      const child = confirmBooking(hold.bookingId);
      child.paidCents = 0; // settled at the salon, visit by visit
      child.seriesId = bookingId;
      booked.push(child);
    } catch (e) {
      if (e instanceof SlotTaken) {
        skippedDates.push(target);
        continue;
      }
      throw e;
    }
  }
  if (booked.length > 0) {
    b.seriesId = bookingId;
    persist();
  }
  return { booked, skippedDates };
}

// --- one stylist's week -----------------------------------------------------

export interface StaffWeekDayView {
  iso: string;
  /** rostered windows that day, epoch ms */
  working: Interval[];
  blocks: CalendarBlock[];
  rosteredMin: number;
  /** minutes actually sold — bookings and walk-ins, clipped to the roster */
  soldMin: number;
}

/**
 * Seven days of one person's chair: what is rostered, what is sold, and where
 * the holes are. The day view answers "who is next"; this answers "how is my
 * week going" for a stylist and "which day is nobody buying" for the owner —
 * the same axis as the day calendar so the two read as one instrument.
 */
export function staffWeek(shopId: string, staffId: string, fromIso: string): StaffWeekDayView[] {
  const shop = shopById(shopId);
  if (!shop) return [];
  const now = Date.now();

  return Array.from({ length: 7 }, (_, i) => addDays(fromIso, i)).map((iso) => {
    const dStart = dayStart(iso);
    const day: Interval = { start: dStart, end: dStart + 24 * 60 * MIN };
    const working = staffWindows(shop, staffId, iso);
    const blocks: CalendarBlock[] = seedBusy(staffId, iso, working).map((b) => ({
      kind: 'walk_in',
      start: b.start,
      end: b.end,
    }));
    for (const b of state.bookings.values()) {
      if (b.staffId !== staffId || b.shopId !== shopId || !bookingBlocks(b, now)) continue;
      if (!overlaps({ start: b.startsAt, end: b.endsAt }, day)) continue;
      blocks.push({
        kind: 'booking',
        bookingId: b.id,
        reference: b.reference,
        guestName: b.guestName,
        serviceNames: b.serviceIds.map((id) => serviceOf(shop, id)?.name.en ?? id),
        status: b.status,
        totalCents: b.quote.totalCents,
        prime: b.isPrime || undefined,
        start: b.startsAt,
        end: b.endsAt,
      });
    }
    blocks.sort((a, b) => a.start - b.start);

    const rosteredMin = working.reduce((n, w) => n + (w.end - w.start) / MIN, 0);
    // Sold time is counted inside the roster only: a Prime squeeze at 19:45
    // on a shift that ends at 20:00 sells 15 rostered minutes, not its whole
    // duration — utilisation above 100% would be a lie about the roster.
    const soldMin = blocks.reduce((n, b) => {
      for (const w of working) {
        const s = Math.max(b.start, w.start);
        const e = Math.min(b.end, w.end);
        if (e > s) n += (e - s) / MIN;
      }
      return n;
    }, 0);

    return { iso, working, blocks, rosteredMin, soldMin: Math.min(soldMin, rosteredMin) };
  });
}

export function getBooking(id: string): Booking | undefined {
  return state.bookings.get(id);
}

export function bookingsForDevice(deviceId: string): Booking[] {
  const now = Date.now();
  return [...state.bookings.values()]
    .filter((b) => {
      if (b.deviceId !== deviceId || b.status === 'hold') return false;
      // An abandoned checkout whose hold timed out is not an appointment —
      // listing it as "Payment pending" until its start date would be a lie.
      if (b.status === 'pending_payment' && (b.holdExpiresAt ?? 0) < now) return false;
      return true;
    })
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
  /** Sold as Prime flexible — an extra squeezed in on top of the grid. */
  prime?: boolean;
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
        prime: b.isPrime || undefined,
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
      guestPhone: b.guestPhone ?? '',
      guestNote: b.guestNote ?? '',
      // so a stylist can write into the customer record straight from their day
      customerKey: customerKeyOf(b),
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
  refundedCents: number;
  depositCents: number;
  cancellation: { feeCents: number; refundCents: number; reason: string } | null;
  policy: { freeUntilHours: number; lateFeePercent: number; noShowFeePercent: number };
  shop: { id: string; slug: string; name: string; emoji: string; district: string; gradient: [string, string] } | null;
  services: Array<{ name: { en: string; de: string }; emoji: string }>;
  serviceIds: string[];
  staffId: string;
  staffName: string | null;
  review: { rating: number; text: string; date: string } | null;
  tipCents: number;
  isPrime: boolean;
  /** what the receipt needs: the priced lines and the VAT inside the total */
  vatCents: number;
  breakdown: Array<{ label: string; cents: number }>;
  /** the shop's street address at the time of viewing — a Beleg must carry it */
  shopAddress: string;
  /** how the online part was paid, presentation-safe — null means at the salon */
  payment: { method: PaymentMethod; label: string } | null;
  guestName: string;
  seriesId: string | null;
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
      refundedCents: b.refundedCents ?? 0,
      depositCents: b.quote.depositCents,
      cancellation: b.cancellation ?? null,
      policy: b.policySnapshot,
      shop: shop
        ? { id: shop.id, slug: shop.slug, name: shop.name, emoji: shop.emoji, district: shop.district, gradient: shop.gradient }
        : null,
      services: b.serviceIds.map((id) => {
        const s = shop ? serviceOf(shop, id) : undefined;
        return s ? { name: s.name, emoji: s.emoji } : { name: { en: id, de: id }, emoji: '✨' };
      }),
      serviceIds: b.serviceIds,
      staffId: b.staffId,
      staffName: shop ? effectiveStaff(shop.id).find((s) => s.id === b.staffId)?.name ?? null : null,
      review: b.review ?? null,
      tipCents: b.tipCents ?? 0,
      vatCents: b.quote.vatCents,
      breakdown: b.quote.breakdown,
      shopAddress: shop?.address ?? '',
      payment: b.payment ?? null,
      guestName: b.guestName,
      seriesId: b.seriesId ?? null,
      isPrime: b.isPrime ?? false,
    };
  });
}

// ---------------------------------------------------------------------------
// vouchers & loyalty
// ---------------------------------------------------------------------------

// --- gift cards (Gutscheine) ------------------------------------------------
//
// The salon's oldest revenue product: money paid today for a visit somebody
// else takes later. A card is bought for a euro amount, carries a code in an
// unambiguous alphabet, and redeems through the same voucher field checkout
// already has — partially, keeping its remaining balance, until it is empty.
// The balance is only ever deducted when a booking actually confirms; a hold
// that dies takes nothing with it.

export interface GiftCard {
  code: string;
  shopId: string;
  initialCents: number;
  balanceCents: number;
  buyerDeviceId: string;
  toName?: string;
  fromName?: string;
  message?: string;
  payment?: { method: PaymentMethod; label: string };
  createdAt: number;
  redemptions: Array<{ at: number; cents: number; reference: string }>;
}

export const GIFT_MIN_CENTS = 1000;
export const GIFT_MAX_CENTS = 50000;

/** No 0/O, 1/I/L — a code read over the phone must survive the phone. */
const GIFT_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function buyGiftCard(
  shopId: string,
  deviceId: string,
  amountCents: number,
  opts: { toName?: string; fromName?: string; message?: string } = {},
  payment?: { method: PaymentMethod; label: string },
): GiftCard {
  if (!shopById(shopId)) throw new Error('shop_not_found');
  if (amountCents < GIFT_MIN_CENTS || amountCents > GIFT_MAX_CENTS) throw new Error('bad_amount');
  let code = '';
  do {
    const part = () =>
      Array.from({ length: 4 }, () => GIFT_ALPHABET[Math.floor(Math.random() * GIFT_ALPHABET.length)]).join('');
    code = `GC-${part()}-${part()}`;
  } while (state.giftCards.has(code));
  const card: GiftCard = {
    code,
    shopId,
    initialCents: amountCents,
    balanceCents: amountCents,
    buyerDeviceId: deviceId,
    toName: opts.toName?.trim() || undefined,
    fromName: opts.fromName?.trim() || undefined,
    message: opts.message?.trim() || undefined,
    payment,
    createdAt: Date.now(),
    redemptions: [],
  };
  state.giftCards.set(code, card);
  persist();
  return card;
}

export function giftCard(code: string): GiftCard | null {
  return state.giftCards.get(code.trim().toUpperCase()) ?? null;
}

export function giftCardsForDevice(deviceId: string): GiftCard[] {
  return [...state.giftCards.values()]
    .filter((c) => c.buyerDeviceId === deviceId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** The liability view: what was sold, and how much of it is still unredeemed. */
export function giftCardsForShop(shopId: string): {
  soldCount: number;
  soldCents: number;
  outstandingCents: number;
  cards: GiftCard[];
} {
  const cards = [...state.giftCards.values()]
    .filter((c) => c.shopId === shopId)
    .sort((a, b) => b.createdAt - a.createdAt);
  return {
    soldCount: cards.length,
    soldCents: cards.reduce((n, c) => n + c.initialCents, 0),
    outstandingCents: cards.reduce((n, c) => n + c.balanceCents, 0),
    cards,
  };
}

/** Called once, on the hold→confirmed transition. Clamped, never negative. */
function redeemGiftCard(b: Booking): void {
  if (!b.voucherCode || !b.giftCents) return;
  const card = state.giftCards.get(b.voucherCode);
  if (!card) return;
  const cents = Math.min(card.balanceCents, b.giftCents);
  if (cents <= 0) return;
  card.balanceCents -= cents;
  card.redemptions.push({ at: Date.now(), cents, reference: b.reference });
}

export type VoucherResult =
  | { ok: true; voucher: Voucher; discountCents: number; giftBalanceCents?: number }
  | { ok: false; reason: 'unknown_code' | 'min_subtotal' | 'empty_card'; minSubtotalCents?: number };

export function validateVoucher(code: string, subtotalCents: number): VoucherResult {
  // Gift cards share the voucher field — one box at checkout, not two.
  const card = state.giftCards.get(code.trim().toUpperCase());
  if (card) {
    if (card.balanceCents <= 0) return { ok: false, reason: 'empty_card' };
    const discountCents = Math.min(card.balanceCents, subtotalCents);
    return {
      ok: true,
      voucher: {
        code: card.code,
        label: { en: 'Gift card', de: 'Gutschein' },
        kind: 'fixed_cents',
        value: card.balanceCents,
        minSubtotalCents: 0,
      },
      discountCents,
      giftBalanceCents: card.balanceCents,
    };
  }
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
  const now = Date.now();
  let earned = 0;
  let spent = 0;
  for (const b of state.bookings.values()) {
    if (b.deviceId !== deviceId) continue;
    if (b.status === 'completed') {
      earned += Math.floor(((b.quote.totalCents + (b.tipCents ?? 0)) / 100) * LOYALTY_EARN_PER_EURO);
    }
    if (['hold', 'pending_payment', 'confirmed', 'completed'].includes(b.status)) {
      // A hold that timed out never becomes a sale — mirror bookingBlocks and
      // give the reserved points back, or they'd be locked up forever.
      if ((b.status === 'hold' || b.status === 'pending_payment') && (b.holdExpiresAt ?? 0) < now) continue;
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
  reply: { text: string; at: string } | null;
}

/** Same reviews, plus what the shop needs to answer them. */
export interface ShopReview extends UserReview {
  bookingId: string;
  staffName: string | null;
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
      reply: b.reviewReply ?? null,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Reviews for the operator: newest first, unanswered ones first of all. */
export function shopReviews(shopId: string): ShopReview[] {
  const shop = shopById(shopId);
  const out: ShopReview[] = [];
  for (const b of state.bookings.values()) {
    if (b.shopId !== shopId || !b.review) continue;
    out.push({
      bookingId: b.id,
      author: b.guestName,
      rating: b.review.rating,
      text: b.review.text,
      date: b.review.date,
      serviceNames: b.serviceIds.map((id) => (shop ? serviceOf(shop, id)?.name : undefined) ?? { en: id, de: id }),
      reply: b.reviewReply ?? null,
      staffName: effectiveStaff(shopId).find((s) => s.id === b.staffId)?.name ?? null,
    });
  }
  return out.sort((a, b) => {
    // An unanswered review is work; answered ones are archive.
    if (!a.reply !== !b.reply) return a.reply ? 1 : -1;
    return a.date < b.date ? 1 : -1;
  });
}

export function setReviewReply(shopId: string, bookingId: string, text: string): void {
  const b = state.bookings.get(bookingId);
  if (!b || b.shopId !== shopId || !b.review) throw new Error('not_found');
  const trimmed = text.trim();
  if (trimmed) b.reviewReply = { text: trimmed, at: new Date().toISOString().slice(0, 10) };
  else delete b.reviewReply;
  persist();
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

export interface WaitlistView extends Omit<WaitlistEntry, 'offer'> {
  /** live offer only — a lapsed one is not shown */
  offer?: { startsAt: number; expiresAt: number };
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

// --- customers -------------------------------------------------------------

export interface CustomerRow {
  /** stable id for this person *at this shop* */
  key: string;
  name: string;
  phone: string;
  visits: number;
  /** completed + confirmed spend, excluding cancelled bookings */
  spentCents: number;
  firstVisit: number | null;
  lastVisit: number | null;
  nextVisit: number | null;
  noShows: number;
  cancellations: number;
  /** what they book most often */
  favouriteService: { id: string; name: { en: string; de: string }; emoji: string } | null;
  /** notes the customer left on their bookings, newest first */
  customerNotes: string[];
  /** private note the shop keeps about them */
  shopNote: string;
  averageRating: number | null;
}

/**
 * A phone number identifies a person better than a device does — the same
 * customer books from a laptop and then a phone, and a salon books them from
 * the front desk. So the phone wins when we have one; otherwise fall back to
 * the device, and lastly to the name typed at the counter.
 */
function customerKeyOf(b: Booking): string {
  const phone = (b.guestPhone ?? '').replace(/[^\d+]/g, '');
  if (phone.length >= 6) return `p:${phone}`;
  if (!b.deviceId.startsWith('shop:')) return `d:${b.deviceId}`;
  return `n:${b.guestName.trim().toLowerCase()}`;
}

/**
 * Everyone who has ever booked at this shop, most recently seen first.
 *
 * Memoised, because it is not cheap: it groups every booking the shop has ever
 * taken — three months of trading is several thousand rows — and both the
 * Customers tab and the message inbox ask for it, the inbox on every change.
 * Uncached it blocked the main thread for over a second each time, which is how
 * an unread badge ends up a second behind the click that cleared it.
 */
export const customersForShop = memoByShop(function customersForShopUncached(shopId: string): CustomerRow[] {
  const shop = shopById(shopId);
  if (!shop) return [];
  const now = Date.now();
  const groups = new Map<string, Booking[]>();
  for (const b of state.bookings.values()) {
    if (b.shopId !== shopId) continue;
    if (b.status === 'pending_payment' && (b.holdExpiresAt ?? 0) < now) continue; // dead hold
    const key = customerKeyOf(b);
    const bucket = groups.get(key);
    if (bucket) bucket.push(b);
    else groups.set(key, [b]);
  }

  const rows: CustomerRow[] = [];
  for (const [key, bookings] of groups) {
    bookings.sort((a, b) => a.startsAt - b.startsAt);
    const kept = bookings.filter((b) => ['confirmed', 'completed'].includes(b.status));
    const past = kept.filter((b) => b.startsAt <= now);
    const future = kept.filter((b) => b.startsAt > now);

    const serviceCount = new Map<string, number>();
    for (const b of kept) for (const id of b.serviceIds) serviceCount.set(id, (serviceCount.get(id) ?? 0) + 1);
    const topId = [...serviceCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const topService = topId ? serviceOf(shop, topId) : undefined;

    const ratings = bookings.map((b) => b.review?.rating).filter((r): r is number => typeof r === 'number');
    // The latest name and phone win — people correct their details over time.
    const latest = [...bookings].reverse();

    rows.push({
      key,
      name: latest.find((b) => b.guestName.trim())?.guestName ?? '—',
      phone: latest.find((b) => b.guestPhone)?.guestPhone ?? '',
      visits: past.length,
      spentCents: kept.reduce((sum, b) => sum + b.quote.totalCents + (b.tipCents ?? 0), 0),
      firstVisit: past[0]?.startsAt ?? null,
      lastVisit: past[past.length - 1]?.startsAt ?? null,
      nextVisit: future[0]?.startsAt ?? null,
      noShows: bookings.filter((b) => b.status === 'no_show').length,
      cancellations: bookings.filter((b) => b.status.startsWith('cancelled')).length,
      favouriteService: topService ? { id: topService.id, name: topService.name, emoji: topService.emoji } : null,
      customerNotes: latest.map((b) => b.guestNote).filter((n): n is string => !!n),
      shopNote: state.customerNotes.get(`${shopId}:${key}`) ?? '',
      averageRating: ratings.length ? Math.round((ratings.reduce((a, r) => a + r, 0) / ratings.length) * 10) / 10 : null,
    });
  }

  return rows.sort((a, b) => (b.lastVisit ?? b.nextVisit ?? 0) - (a.lastVisit ?? a.nextVisit ?? 0));
});

// --- messages --------------------------------------------------------------

/**
 * A message between a salon and one of its customers.
 *
 * Until now the only way for a shop to reach somebody was the phone number on
 * the booking, and the only way for a customer to reach a shop was to ring
 * during opening hours. Both are fine for "I'm running ten minutes late" and
 * hopeless for "can you do Saturday instead?" — which is the question that
 * otherwise becomes a cancellation.
 *
 * A thread is keyed by shop and customer, not by booking, because people are
 * continuous and appointments are not: last month's colour and next month's
 * cut are the same conversation.
 */
export interface Message {
  id: string;
  from: 'shop' | 'customer';
  text: string;
  at: number;
  /** when the *other* side read it, null while unread */
  readAt: number | null;
}

export interface ThreadSummary {
  shopId: string;
  shopName: string;
  shopEmoji: string;
  shopSlug: string;
  customerKey: string;
  customerName: string;
  customerPhone: string;
  lastMessage: Message | null;
  /** unread by whoever asked for the list */
  unread: number;
  /** their next appointment here, so a reply can be answered in context */
  nextVisit: number | null;
}

const threadKey = (shopId: string, customerKey: string) => `${shopId}:${customerKey}`;

export function messageThread(shopId: string, customerKey: string): Message[] {
  return state.messages.get(threadKey(shopId, customerKey)) ?? [];
}

export function sendMessage(
  shopId: string,
  customerKey: string,
  from: 'shop' | 'customer',
  text: string,
): Message | null {
  const body = text.trim().slice(0, 1000);
  if (!body) return null;
  const msg: Message = {
    id: `m-${state.seq++}-${Date.now().toString(36)}`,
    from,
    text: body,
    at: Date.now(),
    readAt: null,
  };
  const key = threadKey(shopId, customerKey);
  state.messages.set(key, [...(state.messages.get(key) ?? []), msg]);
  persist();
  return msg;
}

/** Mark everything the other side sent as read. */
export function markThreadRead(shopId: string, customerKey: string, reader: 'shop' | 'customer'): void {
  const key = threadKey(shopId, customerKey);
  const thread = state.messages.get(key);
  if (!thread) return;
  const now = Date.now();
  let changed = false;
  const next = thread.map((m) => {
    if (m.from === reader || m.readAt !== null) return m;
    changed = true;
    return { ...m, readAt: now };
  });
  if (!changed) return;
  state.messages.set(key, next);
  persist();
}

function unreadFor(thread: Message[], reader: 'shop' | 'customer'): number {
  return thread.filter((m) => m.from !== reader && m.readAt === null).length;
}

function summarise(
  shopId: string,
  customerKey: string,
  thread: Message[],
  reader: 'shop' | 'customer',
  person: { name: string; phone: string; nextVisit: number | null },
): ThreadSummary | null {
  const shop = shopById(shopId);
  if (!shop) return null;
  return {
    shopId,
    shopName: shop.name,
    shopEmoji: shop.emoji,
    shopSlug: shop.slug,
    customerKey,
    customerName: person.name,
    customerPhone: person.phone,
    lastMessage: thread[thread.length - 1] ?? null,
    unread: unreadFor(thread, reader),
    nextVisit: person.nextVisit,
  };
}

/**
 * The salon's inbox.
 *
 * Every customer who has ever booked gets a row, not only the ones who have
 * written — the shop's most useful message is usually the first one, and an
 * inbox that only lists existing conversations makes starting one impossible.
 * Rows with unread messages come first, then live conversations by recency,
 * then everybody else the way the customer list sorts them.
 */
export function shopThreads(shopId: string): ThreadSummary[] {
  const rows = customersForShop(shopId);
  const out: ThreadSummary[] = [];
  for (const c of rows) {
    const thread = messageThread(shopId, c.key);
    const s = summarise(shopId, c.key, thread, 'shop', {
      name: c.name,
      phone: c.phone,
      nextVisit: c.nextVisit,
    });
    if (s) out.push(s);
  }
  return out.sort((a, b) => {
    if (a.unread !== b.unread) return b.unread - a.unread;
    return (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0);
  });
}

/**
 * The customer's side: one thread per salon they have booked with.
 *
 * Their key can differ from shop to shop — a phone typed at one counter, a
 * device at another — so it is derived from their own bookings rather than
 * assumed, exactly the way the shop derived it.
 */
export function threadsForDevice(deviceId: string): ThreadSummary[] {
  const groups = new Map<string, { shopId: string; key: string; bookings: Booking[] }>();
  for (const b of state.bookings.values()) {
    if (b.deviceId !== deviceId || b.status === 'hold') continue;
    const key = customerKeyOf(b);
    const id = threadKey(b.shopId, key);
    const bucket = groups.get(id);
    if (bucket) bucket.bookings.push(b);
    else groups.set(id, { shopId: b.shopId, key, bookings: [b] });
  }

  const now = Date.now();
  const out: ThreadSummary[] = [];
  for (const g of groups.values()) {
    g.bookings.sort((a, b) => a.startsAt - b.startsAt);
    const latest = [...g.bookings].reverse();
    const upcoming = g.bookings.find(
      (b) => b.startsAt > now && ['confirmed', 'pending_payment'].includes(b.status),
    );
    const s = summarise(g.shopId, g.key, messageThread(g.shopId, g.key), 'customer', {
      name: latest.find((b) => b.guestName.trim())?.guestName ?? '',
      phone: latest.find((b) => b.guestPhone)?.guestPhone ?? '',
      nextVisit: upcoming?.startsAt ?? null,
    });
    if (s) out.push(s);
  }
  return out.sort((a, b) => {
    if (a.unread !== b.unread) return b.unread - a.unread;
    return (b.lastMessage?.at ?? 0) - (a.lastMessage?.at ?? 0);
  });
}

/** Badge counts, cheap enough to poll. */
export function unreadForShop(shopId: string): number {
  let n = 0;
  for (const [key, thread] of state.messages) {
    if (!key.startsWith(`${shopId}:`)) continue;
    n += unreadFor(thread, 'shop');
  }
  return n;
}

export function unreadForDevice(deviceId: string): number {
  return threadsForDevice(deviceId).reduce((sum, t) => sum + t.unread, 0);
}

// --- billing: what a shop's receipts must say ------------------------------

/**
 * The legal identity a German Beleg carries.
 *
 * Three fields and a flag, because that is genuinely all a B2C service receipt
 * needs beyond what the booking already knows (research: §14/§33 UStG via the
 * IHK guides; the 2025 E-Rechnung mandate is B2B-only, so a structured XML
 * invoice is deliberately out of scope here). The flag matters most:
 * a Kleinunternehmer under §19 UStG must NOT show VAT — showing it anyway
 * would make the salon owe the stated tax — so the receipt renderer switches
 * to the exemption sentence instead of the VAT block.
 */
export interface BillingProfile {
  /** the legal name receipts are issued under — often not the salon's brand */
  legalName: string;
  /** Steuernummer or USt-IdNr. — one of them belongs on a full Rechnung */
  taxId: string;
  /** §19 UStG Kleinunternehmer: no VAT shown, exemption sentence instead */
  smallBusiness: boolean;
  /** how the salon is reached for invoice questions — the E-Rechnung rules
   *  (BR-DE-2, PEPPOL) require a seller contact and electronic address */
  email: string;
  phone: string;
}

export function billingProfile(shopId: string): BillingProfile {
  const stored = state.billing.get(shopId);
  if (stored) return stored;
  // A workable default for shops that never opened the settings: the brand
  // name as legal name, and a deterministic demo Steuernummer in the Berlin
  // format — obviously replaced by the real one the moment the owner types it.
  const shop = shopById(shopId);
  const h = shopId.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 100000, 7);
  return {
    legalName: shop?.name ?? '',
    taxId: `30/${(h % 900) + 100}/${(h % 90000) + 10000}`,
    smallBusiness: false,
    email: `${shop?.slug ?? shopId}@stylenow.example`,
    phone: `+49 30 ${(h % 900000) + 100000}`,
  };
}

export function setBillingProfile(shopId: string, profile: BillingProfile): void {
  state.billing.set(shopId, {
    legalName: profile.legalName.trim().slice(0, 120),
    taxId: profile.taxId.trim().slice(0, 40),
    smallBusiness: Boolean(profile.smallBusiness),
    email: profile.email.trim().slice(0, 120),
    phone: profile.phone.trim().slice(0, 40),
  });
  persist();
}

// --- notifications ---------------------------------------------------------

/**
 * Something the person should glance at: an appointment coming up, a message
 * waiting, an offer about to lapse, a booking that just arrived.
 *
 * Notices are *derived*, not stored. Every one of them is a restatement of
 * state that already exists — a booking, a thread, an offer — so storing them
 * as rows would create a second copy that could disagree with the first
 * ("notification says 14:00, booking was moved to 15:00"). Deriving them means
 * a moved booking moves its reminder and a read thread retracts its notice,
 * with no cleanup code. What IS per-device is the "seen up to" watermark, and
 * that lives in the client's own storage, not here.
 *
 * The payload is structured rather than pre-written text so the client renders
 * it in the viewer's language.
 */
export interface AppNotice {
  /** stable across recomputations, so the client can tell old from new */
  id: string;
  kind:
    | 'appt_soon'
    | 'appt_tomorrow'
    | 'message'
    | 'offer'
    | 'booking_new'
    | 'booking_moved'
    | 'timeoff'
    // the mirror image of booking_moved: the SHOP changed something and the
    // customer's bell says so
    | 'appt_moved'
    | 'staff_changed';
  /** when this became worth showing — the badge counts notices after the watermark */
  at: number;
  /** where tapping it goes */
  href: string;
  shopId: string;
  shopName: string;
  shopEmoji: string;
  /** counterpart's name — the customer for a shop notice, empty otherwise */
  who: string;
  /** appointment start / offered start, when the notice is about a time */
  startsAt: number | null;
  serviceNames: Array<{ en: string; de: string }>;
  /** first line of the message, for message notices */
  preview: string;
  /** unread count, for message notices */
  count: number;
}

const bySoonest = (a: AppNotice, b: AppNotice) => b.at - a.at;

/** The customer's side: their own appointments, messages, offers. */
export function noticesForDevice(deviceId: string): AppNotice[] {
  const now = Date.now();
  const out: AppNotice[] = [];

  for (const b of state.bookings.values()) {
    if (b.deviceId !== deviceId) continue;
    if (!['confirmed', 'pending_payment'].includes(b.status)) continue;
    if (b.startsAt <= now) continue;
    const shop = shopById(b.shopId);
    if (!shop) continue;
    const base = {
      href: '/bookings',
      shopId: shop.id,
      shopName: shop.name,
      shopEmoji: shop.emoji,
      who: '',
      startsAt: b.startsAt,
      serviceNames: b.serviceIds.map((id) => serviceOf(shop, id)?.name ?? { en: id, de: id }),
      preview: '',
      count: 0,
    };
    // Two reminders, the way a person actually wants them: one the day
    // before to plan around it, one shortly before to leave on time.
    const hoursAway = (b.startsAt - now) / 36e5;
    if (hoursAway <= 3) {
      out.push({ ...base, id: `soon-${b.id}`, kind: 'appt_soon', at: b.startsAt - 3 * 36e5 });
    } else if (hoursAway <= 26) {
      out.push({ ...base, id: `tmrw-${b.id}`, kind: 'appt_tomorrow', at: b.startsAt - 26 * 36e5 });
    }

    // The shop touched this appointment — moved it, or handed it to a
    // different stylist. Recent changes only; old history is not news.
    const changeCutoff = now - 7 * 864e5;
    if (b.shopMovedAt && b.shopMovedAt >= changeCutoff) {
      out.push({
        ...base,
        id: `shmv-${b.id}-${b.shopMovedAt}`,
        kind: 'appt_moved',
        at: b.shopMovedAt,
        preview: b.movedFromStartsAt ? String(b.movedFromStartsAt) : '',
      });
    }
    if (b.reassignedAt && b.reassignedAt >= changeCutoff) {
      out.push({
        ...base,
        id: `rsgn-${b.id}-${b.reassignedAt}`,
        kind: 'staff_changed',
        at: b.reassignedAt,
        who: effectiveStaff(shop.id).find((s) => s.id === b.staffId)?.name ?? '',
      });
    }
  }

  for (const t of threadsForDevice(deviceId)) {
    if (t.unread === 0 || !t.lastMessage) continue;
    out.push({
      id: `msg-${t.shopId}-${t.lastMessage.id}`,
      kind: 'message',
      at: t.lastMessage.at,
      href: `/messages?shop=${t.shopId}`,
      shopId: t.shopId,
      shopName: t.shopName,
      shopEmoji: t.shopEmoji,
      who: '',
      startsAt: null,
      serviceNames: [],
      preview: t.lastMessage.text,
      count: t.unread,
    });
  }

  for (const w of state.waitlist.values()) {
    if (w.deviceId !== deviceId) continue;
    const offer = liveOffer(w);
    if (!offer) continue;
    const shop = shopById(w.shopId);
    if (!shop) continue;
    out.push({
      id: `offer-${w.id}-${offer.startsAt}`,
      kind: 'offer',
      at: w.offer!.offeredAt,
      href: '/bookings',
      shopId: shop.id,
      shopName: shop.name,
      shopEmoji: shop.emoji,
      who: '',
      startsAt: offer.startsAt,
      serviceNames: w.serviceIds.map((id) => serviceOf(shop, id)?.name ?? { en: id, de: id }),
      preview: '',
      count: 0,
    });
  }

  return out.sort(bySoonest);
}

/** The salon's side: messages from customers, bookings that just arrived. */
export function noticesForShop(shopId: string): AppNotice[] {
  const now = Date.now();
  const shop = shopById(shopId);
  if (!shop) return [];
  const out: AppNotice[] = [];

  for (const t of shopThreads(shopId)) {
    if (t.unread === 0 || !t.lastMessage) continue;
    out.push({
      id: `smsg-${shopId}-${t.customerKey}-${t.lastMessage.id}`,
      kind: 'message',
      at: t.lastMessage.at,
      href: `/dashboard/messages?customer=${encodeURIComponent(t.customerKey)}`,
      shopId,
      shopName: shop.name,
      shopEmoji: shop.emoji,
      who: t.customerName,
      startsAt: null,
      serviceNames: [],
      preview: t.lastMessage.text,
      count: t.unread,
    });
  }

  // Bookings customers made themselves in the last two days — the front desk
  // recorded its own walk-ins, it does not need telling about them.
  const cutoff = now - 2 * 864e5;
  for (const b of state.bookings.values()) {
    if (b.shopId !== shopId) continue;
    if (b.createdAt < cutoff) continue;
    if (b.deviceId.startsWith('shop:') || b.deviceId.startsWith('demo:')) continue;
    if (!['confirmed', 'pending_payment'].includes(b.status)) continue;
    out.push({
      id: `bknew-${b.id}`,
      kind: 'booking_new',
      at: b.createdAt,
      href: '/dashboard',
      shopId,
      shopName: shop.name,
      shopEmoji: shop.emoji,
      who: b.guestName || '',
      startsAt: b.startsAt,
      serviceNames: b.serviceIds.map((id) => serviceOf(shop, id)?.name ?? { en: id, de: id }),
      preview: '',
      count: 0,
    });
  }

  // Customers who moved their own appointment — the calendar already shows the
  // new time; this says it changed, which the calendar cannot.
  for (const b of state.bookings.values()) {
    if (b.shopId !== shopId || !b.movedAt || b.movedAt < cutoff) continue;
    out.push({
      id: `bkmv-${b.id}-${b.movedAt}`,
      kind: 'booking_moved',
      at: b.movedAt,
      href: '/dashboard',
      shopId,
      shopName: shop.name,
      shopEmoji: shop.emoji,
      who: b.guestName || '',
      startsAt: b.startsAt,
      serviceNames: b.serviceIds.map((id) => serviceOf(shop, id)?.name ?? { en: id, de: id }),
      // the time it used to be, so the desk knows what just freed up
      preview: b.movedFromStartsAt ? String(b.movedFromStartsAt) : '',
      count: 0,
    });
  }

  // Time off somebody on the team is waiting to hear about.
  for (const st of effectiveStaff(shopId)) {
    for (const a of state.absences.get(st.id) ?? []) {
      if (a.status !== 'pending' || !a.requestedAt) continue;
      out.push({
        id: `toff-${a.id}`,
        kind: 'timeoff',
        at: a.requestedAt,
        href: '/dashboard/hr', // the Approve button lives in the HR panel

        shopId,
        shopName: shop.name,
        shopEmoji: shop.emoji,
        who: st.name,
        startsAt: null,
        serviceNames: [],
        preview: `${a.from}→${a.to}`,
        count: 0,
      });
    }
  }

  return out.sort(bySoonest);
}

export function setCustomerNote(shopId: string, key: string, note: string): void {
  const id = `${shopId}:${key}`;
  if (note.trim()) state.customerNotes.set(id, note.trim());
  else state.customerNotes.delete(id);
  persist();
}

// --- revenue report --------------------------------------------------------

export interface RevenueReport {
  from: string;
  to: string;
  days: Array<{ iso: string; revenueCents: number; bookingCount: number }>;
  totalCents: number;
  bookingCount: number;
  avgTicketCents: number;
  bestDay: { iso: string; revenueCents: number } | null;
  /** revenue not tied to an online booking — walk-ins and counter sales */
  walkInCents: number;
  byService: Array<{ id: string; name: { en: string; de: string }; emoji: string; count: number; revenueCents: number }>;
  byStaff: Array<{ id: string; name: string; count: number; revenueCents: number }>;
  /** how customers chose to pay — bookings with no online payment settle at the salon */
  byMethod: Array<{ method: PaymentMethod; count: number; revenueCents: number }>;
}

/**
 * Money over an arbitrary range, plus where it came from.
 *
 * The per-day figure keeps the same walk-in baseline the Today chart has always
 * shown, so the two screens never contradict each other; that part is reported
 * separately as `walkInCents` so the breakdowns still add up to the total.
 * A booking counts on the day it starts, in shop time.
 */
// --- shop calendar over a range --------------------------------------------

export interface CalendarAppointment {
  id: string;
  reference: string;
  startsAt: number;
  endsAt: number;
  guestName: string;
  guestPhone: string;
  guestNote: string;
  customerKey: string;
  serviceIds: string[];
  serviceNames: string[];
  staffId: string;
  staffName: string;
  status: BookingStatus;
  totalCents: number;
}

export interface CalendarDay {
  iso: string;
  closed: boolean;
  /** how many stylists are rostered at all — 0 means nobody is in */
  staffOn: number;
  occupancyPct: number;
  bookingCount: number;
  revenueCents: number;
  appointments: CalendarAppointment[];
}

/**
 * The shop's diary over a range, one entry per day.
 *
 * The day view answers "what is happening now"; a week or a month answers
 * "where are the holes" — which is the question you ask when deciding whether
 * to run an offer, roster someone off, or take a holiday yourself. Same
 * bookings, different unit of time.
 */
export function shopCalendar(shopId: string, fromIso: string, toIso: string): CalendarDay[] {
  const shop = shopById(shopId);
  if (!shop) return [];
  const now = Date.now();
  const staff = effectiveStaff(shopId);

  const dates: string[] = [];
  for (let iso = fromIso; iso <= toIso && dates.length < 62; iso = addDays(iso, 1)) dates.push(iso);

  return dates.map((iso) => {
    const start = dayStart(iso);
    const end = start + 24 * 60 * MIN;
    const appointments: CalendarAppointment[] = [];
    let revenueCents = 0;

    for (const b of state.bookings.values()) {
      if (b.shopId !== shopId) continue;
      if (b.startsAt < start || b.startsAt >= end) continue;
      if (b.status === 'hold') continue;
      if (b.status === 'pending_payment' && (b.holdExpiresAt ?? 0) < now) continue; // dead hold
      appointments.push({
        id: b.id,
        reference: b.reference,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        guestName: b.guestName,
        guestPhone: b.guestPhone ?? '',
        guestNote: b.guestNote ?? '',
        customerKey: customerKeyOf(b),
        serviceIds: b.serviceIds,
        serviceNames: b.serviceIds.map((id) => serviceOf(shop, id)?.name.en ?? id),
        staffId: b.staffId,
        staffName: staff.find((s) => s.id === b.staffId)?.name ?? '—',
        status: b.status,
        totalCents: b.quote.totalCents,
      });
      if (['confirmed', 'completed'].includes(b.status)) revenueCents += b.quote.totalCents;
    }
    appointments.sort((a, b) => a.startsAt - b.startsAt);

    const closed = isShopClosed(shopId, iso);
    const staffOn = closed ? 0 : staff.filter((s) => staffWindows(shop, s.id, iso).length > 0).length;

    return {
      iso,
      closed,
      staffOn,
      occupancyPct: staffOn === 0 ? 0 : occupancyPct(shop, iso, now),
      bookingCount: appointments.filter((a) => !a.status.startsWith('cancelled')).length,
      revenueCents,
      appointments,
    };
  });
}

export function revenueReport(shopId: string, fromIso: string, toIso: string): RevenueReport {
  const shop = shopById(shopId);
  const empty: RevenueReport = {
    from: fromIso,
    to: toIso,
    days: [],
    totalCents: 0,
    bookingCount: 0,
    avgTicketCents: 0,
    bestDay: null,
    walkInCents: 0,
    byService: [],
    byStaff: [],
    byMethod: [],
  };
  if (!shop) return empty;

  const dates: string[] = [];
  for (let iso = fromIso; iso <= toIso && dates.length < 400; iso = addDays(iso, 1)) dates.push(iso);
  if (dates.length === 0) return empty;

  const today = todayIso();
  const staffNames = new Map(effectiveStaff(shopId).map((s) => [s.id, s.name]));
  const byService = new Map<string, { count: number; revenueCents: number }>();
  const byStaff = new Map<string, { count: number; revenueCents: number }>();
  const byMethod = new Map<PaymentMethod, { count: number; revenueCents: number }>();

  let walkInCents = 0;
  let bookedCents = 0;
  let bookingCount = 0;

  const days = dates.map((iso) => {
    const start = dayStart(iso);
    const end = start + 24 * 60 * MIN;
    let dayCents = 0;
    let dayCount = 0;
    for (const b of state.bookings.values()) {
      if (b.shopId !== shopId) continue;
      if (!['confirmed', 'completed'].includes(b.status)) continue;
      if (b.startsAt < start || b.startsAt >= end) continue;
      dayCents += b.quote.totalCents;
      dayCount += 1;
      const staff = byStaff.get(b.staffId) ?? { count: 0, revenueCents: 0 };
      byStaff.set(b.staffId, { count: staff.count + 1, revenueCents: staff.revenueCents + b.quote.totalCents });
      const method = b.payment?.method ?? 'at_salon';
      const pm = byMethod.get(method) ?? { count: 0, revenueCents: 0 };
      byMethod.set(method, { count: pm.count + 1, revenueCents: pm.revenueCents + b.quote.totalCents });
      // A basket's total is split across its services by list price, so a
      // two-service booking doesn't credit both with the whole ticket.
      const prices = b.serviceIds.map((id) => serviceOf(shop, id)?.basePriceCents ?? 0);
      const sum = prices.reduce((a, p) => a + p, 0);
      b.serviceIds.forEach((id, i) => {
        const share = sum > 0 ? Math.round((prices[i] / sum) * b.quote.totalCents) : Math.round(b.quote.totalCents / b.serviceIds.length);
        const cur = byService.get(id) ?? { count: 0, revenueCents: 0 };
        byService.set(id, { count: cur.count + 1, revenueCents: cur.revenueCents + share });
      });
    }
    // Same deterministic walk-in baseline the Today chart uses — but only for
    // days that have actually happened. A range reaching into the future is an
    // order book, and nobody has walked in yet.
    const noise = iso <= today ? (hash(`${shopId}:${iso}:rev`) % 40_000) + 25_000 : 0;
    walkInCents += noise;
    bookedCents += dayCents;
    bookingCount += dayCount;
    return { iso, revenueCents: dayCents + noise, bookingCount: dayCount };
  });

  const totalCents = bookedCents + walkInCents;
  const bestDay = days.reduce<{ iso: string; revenueCents: number } | null>(
    (best, d) => (best === null || d.revenueCents > best.revenueCents ? { iso: d.iso, revenueCents: d.revenueCents } : best),
    null,
  );

  return {
    from: fromIso,
    to: toIso,
    days,
    totalCents,
    bookingCount,
    avgTicketCents: bookingCount > 0 ? Math.round(bookedCents / bookingCount) : 0,
    bestDay,
    walkInCents,
    byService: [...byService.entries()]
      .map(([id, v]) => {
        const svc = serviceOf(shop, id);
        return { id, name: svc?.name ?? { en: id, de: id }, emoji: svc?.emoji ?? '✨', ...v };
      })
      .sort((a, b) => b.revenueCents - a.revenueCents),
    byStaff: [...byStaff.entries()]
      .map(([id, v]) => ({ id, name: staffNames.get(id) ?? '—', ...v }))
      .sort((a, b) => b.revenueCents - a.revenueCents),
    byMethod: [...byMethod.entries()]
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.revenueCents - a.revenueCents),
  };
}

// --- daily closing (Tagesabschluss / Z-Bericht) ----------------------------

/**
 * One day's money, closed out the way a German till expects it: what was
 * earned, the VAT inside it, tips (staff money, outside the taxable total),
 * cancellation fees kept, refunds issued, and the split by payment method.
 * Everything is derived from the bookings of that day — no stored copy that
 * could drift from the calendar it summarizes.
 */
export interface DayCloseReport {
  iso: string;
  shopName: string;
  shopAddress: string;
  generatedAt: number;
  completedCount: number;
  noShowCount: number;
  cancelledCount: number;
  /** completed appointments' service revenue, gross */
  grossCents: number;
  vatCents: number;
  tipsCents: number;
  /** late-cancellation and no-show fees the shop kept */
  feesCents: number;
  refundedCents: number;
  byMethod: Array<{ method: PaymentMethod; count: number; cents: number }>;
}

export function dayCloseReport(shopId: string, isoDate: string): DayCloseReport {
  const shop = shopById(shopId);
  const report: DayCloseReport = {
    iso: isoDate,
    shopName: shop?.name ?? '',
    shopAddress: shop?.address ?? '',
    generatedAt: Date.now(),
    completedCount: 0,
    noShowCount: 0,
    cancelledCount: 0,
    grossCents: 0,
    vatCents: 0,
    tipsCents: 0,
    feesCents: 0,
    refundedCents: 0,
    byMethod: [],
  };
  if (!shop) return report;
  const start = dayStart(isoDate);
  const end = start + 24 * 60 * MIN;
  const byMethod = new Map<PaymentMethod, { count: number; cents: number }>();

  for (const b of state.bookings.values()) {
    if (b.shopId !== shopId || b.startsAt < start || b.startsAt >= end) continue;
    if (b.status === 'completed') {
      report.completedCount += 1;
      report.grossCents += b.quote.totalCents;
      report.vatCents += b.quote.vatCents;
      report.tipsCents += b.tipCents ?? 0;
      const method = b.payment?.method ?? 'at_salon';
      const row = byMethod.get(method) ?? { count: 0, cents: 0 };
      byMethod.set(method, { count: row.count + 1, cents: row.cents + b.quote.totalCents + (b.tipCents ?? 0) });
    } else if (b.status === 'no_show') {
      report.noShowCount += 1;
      report.feesCents += b.cancellation?.feeCents ?? 0;
    } else if (b.status === 'cancelled_by_customer' || b.status === 'cancelled_by_shop') {
      report.cancelledCount += 1;
      report.feesCents += b.cancellation?.feeCents ?? 0;
      report.refundedCents += b.refundedCents ?? 0;
    }
  }

  report.byMethod = [...byMethod.entries()]
    .map(([method, v]) => ({ method, ...v }))
    .sort((a, b) => b.cents - a.cents);
  return report;
}

// --- roster calendar -------------------------------------------------------

/**
 * What one person's one day looks like, in the order the shop cares about:
 * a shop closure beats an absence beats the roster.
 */
export type RosterState = 'closed' | 'absent' | 'working' | 'off';

export interface RosterDay {
  iso: string;
  state: RosterState;
  /** the absence covering this day, so a click can remove exactly that one */
  absenceId?: string;
  kind?: AbsenceKind;
  note?: string;
  /** rostered minutes for the weekday, kept even when absent — that is the
   *  cover the shop has to find */
  scheduledMin: number;
  bookedMin: number;
  bookingCount: number;
}

export interface RosterRow {
  staffId: string;
  name: string;
  role: { en: string; de: string };
  tier: 'senior' | 'stylist';
  locationId: string | null;
  days: RosterDay[];
  /** working days in the range, and how many of them are lost to absence */
  workingDays: number;
  absentDays: number;
}

export interface RosterCalendar {
  dates: string[];
  rows: RosterRow[];
  closures: ShopClosure[];
}

/**
 * The team's plan as a grid: one row per person, one column per day.
 *
 * A list of absences answers "when is Lena away"; this answers the question a
 * shop actually asks — "who is covering Thursday" — which you cannot see by
 * reading per-person cards one after another.
 */
export function rosterCalendar(shopId: string, fromIso: string, toIso: string): RosterCalendar {
  const shop = shopById(shopId);
  if (!shop) return { dates: [], rows: [], closures: [] };

  const dates: string[] = [];
  for (let iso = fromIso; iso <= toIso && dates.length < 120; iso = addDays(iso, 1)) dates.push(iso);

  const rows = effectiveStaff(shopId).map((st) => {
    let workingDays = 0;
    let absentDays = 0;

    const days = dates.map<RosterDay>((iso) => {
      const start = dayStart(iso);
      const end = start + 24 * 60 * MIN;
      const dow = isoDow(start + 12 * 60 * MIN);
      const shifts = st.shifts[dow] ?? [];
      const scheduledMin = shifts.reduce((sum, w) => sum + (w.endMin - w.startMin), 0);

      let bookedMin = 0;
      let bookingCount = 0;
      for (const b of state.bookings.values()) {
        if (b.shopId !== shopId || b.staffId !== st.id) continue;
        if (!['confirmed', 'completed'].includes(b.status)) continue;
        if (b.startsAt < start || b.startsAt >= end) continue;
        bookedMin += (b.endsAt - b.startsAt) / MIN;
        bookingCount += 1;
      }

      // Pending requests are questions, not absences: the calendar must agree
      // with availability, which keeps selling these days until approval.
      const absence = (state.absences.get(st.id) ?? []).find(
        (a) => a.status !== 'pending' && iso >= a.from && iso <= a.to,
      );
      let stateOfDay: RosterState;
      if (isShopClosed(shopId, iso)) stateOfDay = 'closed';
      else if (absence) stateOfDay = 'absent';
      else if (scheduledMin > 0) stateOfDay = 'working';
      else stateOfDay = 'off';

      if (stateOfDay === 'working') workingDays += 1;
      // Only count an absence against a day the person would have worked.
      if (stateOfDay === 'absent' && scheduledMin > 0) absentDays += 1;

      return {
        iso,
        state: stateOfDay,
        absenceId: absence?.id,
        kind: absence?.kind,
        note: absence?.note,
        scheduledMin,
        bookedMin: Math.round(bookedMin),
        bookingCount,
      };
    });

    return {
      staffId: st.id,
      name: st.name,
      role: st.role,
      tier: st.tier,
      locationId: st.locationId ?? null,
      days,
      workingDays,
      absentDays,
    };
  });

  return {
    dates,
    rows,
    closures: shopClosures(shopId).filter((c) => c.to >= fromIso && c.from <= toIso),
  };
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

export interface ShopWaitlistRow {
  id: string;
  isoDate: string;
  serviceIds: string[];
  serviceNames: Array<{ en: string; de: string }>;
  createdAt: number;
  /** free starts that day for what they asked for — the reason to call them */
  freeSlots: number;
  nextFreeAt: number | null;
  /** the first few free starts, so an offer is one tap rather than a search */
  slotStarts: number[];
  /** what this request is worth at list price — the money the gap is holding */
  valueCents: number;
  /** live offer, if one is out; expired offers read as no offer */
  offer: { startsAt: number; expiresAt: number } | null;
}

/**
 * Who is waiting, and whether anything has opened up for them.
 *
 * The waitlist existed but only the customer could see it, so a cancellation
 * freed a seat and nobody was told. This is the other half: the front desk
 * sees who wanted that day and whether it is now bookable.
 */
export function waitlistForShop(shopId: string, fromIso: string): ShopWaitlistRow[] {
  const shop = shopById(shopId);
  if (!shop) return [];
  return [...state.waitlist.values()]
    .filter((w) => w.shopId === shopId && w.isoDate >= fromIso)
    .sort((a, b) => (a.isoDate === b.isoDate ? a.createdAt - b.createdAt : a.isoDate < b.isoDate ? -1 : 1))
    .map((w) => {
      let slots: ApiSlot[] = [];
      try {
        slots = availability(shopId, w.serviceIds, w.isoDate, `shop:${shopId}`, null).slots;
      } catch {
        slots = []; // service archived since they joined — nothing to offer
      }
      return {
        id: w.id,
        isoDate: w.isoDate,
        serviceIds: w.serviceIds,
        serviceNames: w.serviceIds.map((id) => serviceOf(shop, id)?.name ?? { en: id, de: id }),
        createdAt: w.createdAt,
        freeSlots: slots.length,
        nextFreeAt: slots[0]?.start ?? null,
        slotStarts: slots.slice(0, 4).map((s) => s.start),
        valueCents: w.serviceIds.reduce((n, id) => n + (serviceOf(shop, id)?.basePriceCents ?? 0), 0),
        offer: liveOffer(w),
      };
    });
}

/** An offer that has lapsed is not an offer — readers see it as none. */
function liveOffer(w: WaitlistEntry): { startsAt: number; expiresAt: number } | null {
  if (!w.offer) return null;
  if (w.offer.expiresAt < Date.now()) return null;
  return { startsAt: w.offer.startsAt, expiresAt: w.offer.expiresAt };
}

export const WAITLIST_OFFER_TTL_MIN = 30;

/**
 * Offer one concrete free time to somebody on the waiting list.
 *
 * Deliberately NOT a seat hold: the engine's holds are how money meets seats,
 * and parking a phantom hold for half an hour would block the very gap the
 * shop is trying to sell to anyone who walks in meanwhile. The offer is a
 * flag with a deadline — the customer books it through the normal
 * seat-before-money path, and if a walk-in beats them to it, the 409 flow
 * offers the alternatives it always offers. First come stays first served.
 */
export function offerWaitlistSlot(shopId: string, entryId: string, startsAt: number): WaitlistEntry {
  const w = state.waitlist.get(entryId);
  if (!w || w.shopId !== shopId) throw new Error('not_found');
  // Only offer what is actually free right now, for exactly what they asked.
  const slots = availability(shopId, w.serviceIds, isoDateOf(startsAt), `shop:${shopId}`, null).slots;
  if (!slots.some((s) => s.start === startsAt)) throw new Error('slot_gone');
  const now = Date.now();
  w.offer = { startsAt, offeredAt: now, expiresAt: now + WAITLIST_OFFER_TTL_MIN * 60_000 };
  persist();
  return w;
}

export function waitlistForDevice(deviceId: string): WaitlistView[] {
  return [...state.waitlist.values()]
    .filter((w) => w.deviceId === deviceId)
    .sort((a, b) => (a.isoDate < b.isoDate ? -1 : 1))
    .map((w) => {
      const shop = shopById(w.shopId);
      return {
        ...w,
        // The customer only ever sees a live offer; a lapsed one reads as none.
        offer: liveOffer(w) ?? undefined,
        shop: shop ? { slug: shop.slug, name: shop.name, emoji: shop.emoji } : null,
        serviceNames: w.serviceIds.map((id) => (shop ? serviceOf(shop, id)?.name : undefined) ?? { en: id, de: id }),
      };
    });
}

// The demo history has to be written after the module has finished defining
// itself: it reads `effectiveStaff`, which is a const and would still be in its
// temporal dead zone if this ran up beside the localStorage restore. Guarded
// inside, so a restored snapshot carrying real bookings is never overwritten.
if (IS_BROWSER) seedDemoIfEmpty();
