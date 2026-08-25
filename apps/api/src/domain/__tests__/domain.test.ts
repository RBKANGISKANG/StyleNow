/**
 * Dependency-free sanity tests for the pure domain layer.
 * Run: npx tsx apps/api/src/domain/__tests__/domain.test.ts
 */
import assert from 'node:assert/strict';
import {
  mergeIntervals,
  subtractIntervals,
  slotsForStaff,
  aggregateSlots,
  applyTravelWindows,
  staffOccupancy,
  resourceOccupancy,
} from '../availability.js';
import { evaluatePrice, cancellationOutcome, type PricingRule } from '../pricing.js';
import { rank, shrunkRating, type MatchCandidate } from '../matching.js';

const MIN = 60_000;
const t = (h: number, m = 0) => Date.UTC(2026, 7, 10, h, m); // Mon 10 Aug 2026

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log('availability');

check('mergeIntervals collapses overlap and adjacency', () => {
  const merged = mergeIntervals([
    { start: t(9), end: t(10) },
    { start: t(10), end: t(11) },
    { start: t(12), end: t(13) },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].end, t(11));
});

check('subtractIntervals carves busy blocks out of the working window', () => {
  const free = subtractIntervals(
    [{ start: t(9), end: t(18) }],
    [
      { start: t(11), end: t(12) },
      { start: t(15), end: t(15, 30) },
    ],
  );
  assert.deepEqual(
    free.map((f) => [f.start, f.end]),
    [
      [t(9), t(11)],
      [t(12), t(15)],
      [t(15, 30), t(18)],
    ],
  );
});

const rules = {
  slotGranularityMin: 15,
  bufferBeforeMin: 0,
  bufferAfterMin: 10,
  bookingLeadMin: 60,
  bookingHorizonDays: 90,
};

check('slotsForStaff respects duration, buffer and granularity', () => {
  const slots = slotsForStaff(
    { staffId: 'a', working: [{ start: t(9), end: t(12) }], busy: [] },
    { durationMin: 60, processingGapMin: 0, finishMin: 0 },
    rules,
    t(7),
  );
  assert.equal(slots[0].start, t(9));
  // last slot must end (incl. 10 min buffer) by 12:00 → starts 10:45
  assert.equal(slots[slots.length - 1].start, t(10, 45));
  assert.equal(slots[0].occupancy.end, t(10, 10));
});

check('lead time hides slots that are too soon', () => {
  const slots = slotsForStaff(
    { staffId: 'a', working: [{ start: t(9), end: t(12) }], busy: [] },
    { durationMin: 30, processingGapMin: 0, finishMin: 0 },
    rules,
    t(9, 30), // now
  );
  assert.ok(slots.every((s) => s.start >= t(10, 30)));
});

check('an existing booking removes the overlapping slots', () => {
  const slots = slotsForStaff(
    {
      staffId: 'a',
      working: [{ start: t(9), end: t(13) }],
      busy: [{ start: t(10), end: t(11) }],
    },
    { durationMin: 30, processingGapMin: 0, finishMin: 0 },
    rules,
    t(6),
  );
  assert.ok(!slots.some((s) => s.start >= t(9, 45) && s.start < t(11)));
});

check('processing gap is included in the held window', () => {
  const slots = slotsForStaff(
    { staffId: 'a', working: [{ start: t(9), end: t(12) }], busy: [] },
    { durationMin: 30, processingGapMin: 30, finishMin: 15 },
    { ...rules, bufferAfterMin: 0 },
    t(6),
  );
  assert.equal(slots[0].end - slots[0].start, 75 * MIN);
});

check('the candidate grid anchors to the shift start, not an epoch grid', () => {
  // A shift opening at 08:50 must offer 08:50 / 09:05 / 09:20 — the same grid
  // find_free_slots() produces in SQL. Snapping to an absolute epoch grid would
  // silently yield a disjoint set of times.
  const slots = slotsForStaff(
    { staffId: 'a', working: [{ start: t(8, 50), end: t(11) }], busy: [] },
    { durationMin: 30, processingGapMin: 0, finishMin: 0 },
    { ...rules, bufferAfterMin: 0 },
    t(6),
  );
  assert.equal(slots[0].start, t(8, 50));
  assert.equal(slots[1].start, t(9, 5));
});

check('the last slot leaves room for the after-buffer', () => {
  const slots = slotsForStaff(
    { staffId: 'a', working: [{ start: t(9), end: t(12) }], busy: [] },
    { durationMin: 60, processingGapMin: 0, finishMin: 0 },
    rules, // bufferAfterMin: 10
    t(6),
  );
  // 10:45 + 60 min + 10 min buffer = 11:55. An 11:00 start would spill past close.
  assert.equal(slots[slots.length - 1].start, t(10, 45));
});

check('a processing gap frees the stylist but holds the chair', () => {
  const svc = { durationMin: 30, processingGapMin: 40, finishMin: 20 };
  const noBuffer = { ...rules, bufferAfterMin: 0 };
  const held = staffOccupancy(t(9), svc, noBuffer);
  assert.equal(held.length, 2);
  assert.equal(held[0].end, t(9, 30));          // application done
  assert.equal(held[1].start, t(10, 10));       // finishing starts after development
  const chair = resourceOccupancy(t(9), svc, noBuffer);
  assert.equal(chair.start, t(9));
  assert.equal(chair.end, t(10, 30));           // chair held throughout
});

check('another booking may be taken inside a development gap', () => {
  const colour = { durationMin: 30, processingGapMin: 40, finishMin: 20 };
  const noBuffer = { ...rules, bufferAfterMin: 0 };
  const busy = staffOccupancy(t(9), colour, noBuffer);
  const cuts = slotsForStaff(
    { staffId: 'a', working: [{ start: t(9), end: t(12) }], busy },
    { durationMin: 30, processingGapMin: 0, finishMin: 0 },
    noBuffer,
    t(6),
  );
  assert.ok(cuts.some((s) => s.start === t(9, 30)));  // the development window
  assert.ok(!cuts.some((s) => s.start === t(9)));      // application window blocked
  assert.ok(!cuts.some((s) => s.start === t(10, 15))); // finishing window blocked
});

check('aggregateSlots suggests the least-loaded stylist', () => {
  const merged = aggregateSlots(
    [
      { staffId: 'busy', start: t(10), end: t(11), occupancy: { start: t(10), end: t(11) } },
      { staffId: 'free', start: t(10), end: t(11), occupancy: { start: t(10), end: t(11) } },
    ],
    { busy: 300, free: 40 },
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].suggestedStaffId, 'free');
  assert.deepEqual(merged[0].staffIds.sort(), ['busy', 'free']);
});

check('mobile travel windows drop unreachable slots', () => {
  const slots = slotsForStaff(
    { staffId: 'm', working: [{ start: t(9), end: t(13) }], busy: [] },
    { durationMin: 60, processingGapMin: 0, finishMin: 0 },
    { ...rules, bufferAfterMin: 0 },
    t(6),
  );
  const reachable = applyTravelWindows(slots, { toMin: 30, fromMin: 30 }, [
    { start: t(11), end: t(11, 30) },
  ]);
  assert.ok(!reachable.some((s) => s.start === t(10, 45)));
  assert.ok(reachable.some((s) => s.start === t(9, 30)));
});

console.log('pricing');

const lastMinute: PricingRule = {
  id: 'r1',
  kind: 'last_minute',
  name: 'Last-minute -20 %',
  leadHoursMax: 6,
  adjustKind: 'percent',
  adjustValue: -20,
  priority: 200,
  stackable: false,
};
const peak: PricingRule = {
  id: 'r2',
  kind: 'occupancy',
  name: 'Peak +15 %',
  occupancyMinPct: 80,
  adjustKind: 'percent',
  adjustValue: 15,
  priority: 100,
  stackable: false,
};

const baseCtx = {
  basePriceCents: 5000,
  slotStart: t(18),
  now: t(9),
  occupancyPct: 50,
  dow: 1,
  minuteOfDay: 18 * 60,
  isoDate: '2026-08-10',
  isNewCustomer: false,
  isRepeatOfSameServiceWithin90d: false,
};

check('last-minute discount applies inside the lead window', () => {
  const r = evaluatePrice([lastMinute], { ...baseCtx, now: t(15) });
  assert.equal(r.finalPriceCents, 4000);
  assert.equal(r.applied[0].deltaCents, -1000);
});

check('peak surcharge applies when the day is full', () => {
  const r = evaluatePrice([peak], { ...baseCtx, occupancyPct: 92 });
  assert.equal(r.finalPriceCents, 5750);
});

check('surge never hits a repeat customer of the same service', () => {
  const r = evaluatePrice([peak], {
    ...baseCtx,
    occupancyPct: 92,
    isRepeatOfSameServiceWithin90d: true,
  });
  assert.equal(r.finalPriceCents, 5000);
  assert.equal(r.applied.length, 0);
});

check('uplift is hard-capped at +25 % however many rules fire', () => {
  const greedy: PricingRule[] = [1, 2, 3].map((i) => ({
    id: `g${i}`,
    kind: 'seasonal',
    name: `Greedy ${i}`,
    adjustKind: 'percent',
    adjustValue: 30,
    priority: i,
    stackable: true,
  }));
  const r = evaluatePrice(greedy, baseCtx);
  assert.equal(r.finalPriceCents, 6250);
  assert.equal(r.clamped, true);
});

check('the cap appears in the audit trail so the breakdown reconciles', () => {
  const greedy: PricingRule[] = [1, 2, 3].map((i) => ({
    id: `g${i}`,
    kind: 'seasonal',
    name: `Greedy ${i}`,
    adjustKind: 'percent',
    adjustValue: 30,
    priority: i,
    stackable: true,
  }));
  const r = evaluatePrice(greedy, baseCtx);
  const sum = r.applied.reduce((a, x) => a + x.deltaCents, baseCtx.basePriceCents);
  assert.equal(sum, r.finalPriceCents);
  assert.equal(r.applied.at(-1)?.ruleId, 'platform_cap');
});

check('a set_cents discount survives the repeat-customer guard', () => {
  const promo: PricingRule = {
    id: 'p1',
    kind: 'seasonal',
    name: 'Autumn price EUR 40',
    adjustKind: 'set_cents',
    adjustValue: 4000,
    priority: 50,
    stackable: false,
  };
  const r = evaluatePrice([promo], { ...baseCtx, isRepeatOfSameServiceWithin90d: true });
  assert.equal(r.finalPriceCents, 4000);
});

check('a set_cents uplift is still blocked for repeat customers', () => {
  const surge: PricingRule = {
    id: 'p2',
    kind: 'occupancy',
    name: 'Saturday price EUR 60',
    adjustKind: 'set_cents',
    adjustValue: 6000,
    priority: 50,
    stackable: false,
  };
  const r = evaluatePrice([surge], { ...baseCtx, isRepeatOfSameServiceWithin90d: true });
  assert.equal(r.finalPriceCents, 5000);
});

check('non-stackable rules: only the highest priority wins', () => {
  const r = evaluatePrice([lastMinute, peak], {
    ...baseCtx,
    now: t(15),
    occupancyPct: 92,
  });
  assert.equal(r.applied.length, 1);
  assert.equal(r.applied[0].ruleId, 'r1');
});

console.log('cancellation');

check('cancelling inside the free window refunds everything', () => {
  const o = cancellationOutcome({
    totalCents: 5000,
    paidCents: 5000,
    startsAt: t(20),
    cancelledAt: t(9) - 48 * 60 * MIN,
    freeUntilHours: 24,
    lateFeePercent: 50,
    noShowFeePercent: 100,
    isNoShow: false,
    cancelledBy: 'customer',
  });
  assert.equal(o.feeCents, 0);
  assert.equal(o.refundCents, 5000);
});

check('late cancellation charges the policy percentage', () => {
  const o = cancellationOutcome({
    totalCents: 5000,
    paidCents: 5000,
    startsAt: t(20),
    cancelledAt: t(18),
    freeUntilHours: 24,
    lateFeePercent: 50,
    noShowFeePercent: 100,
    isNoShow: false,
    cancelledBy: 'customer',
  });
  assert.equal(o.feeCents, 2500);
  assert.equal(o.refundCents, 2500);
});

check('an over-100 % no-show fee cannot under-refund the customer', () => {
  const o = cancellationOutcome({
    totalCents: 5000,
    paidCents: 5000,
    startsAt: t(20),
    cancelledAt: t(20, 30),
    freeUntilHours: 24,
    lateFeePercent: 50,
    noShowFeePercent: 150, // numeric(5,2) lets a shop key this in
    isNoShow: true,
    cancelledBy: 'customer',
  });
  assert.equal(o.feeCents, 5000);
  assert.equal(o.feeCents + o.refundCents, 5000);
});

check('shop-side cancellation always refunds in full', () => {
  const o = cancellationOutcome({
    totalCents: 5000,
    paidCents: 5000,
    startsAt: t(20),
    cancelledAt: t(19, 30),
    freeUntilHours: 24,
    lateFeePercent: 50,
    noShowFeePercent: 100,
    isNoShow: false,
    cancelledBy: 'shop',
  });
  assert.equal(o.feeCents, 0);
  assert.equal(o.refundCents, 5000);
});

// A no-show is only ever recorded by the shop, so if the shop branch is
// checked first the no-show fee can never be charged at all.
check('a no-show still costs the customer even though the shop records it', () => {
  const o = cancellationOutcome({
    totalCents: 5000,
    paidCents: 1000, // deposit only
    startsAt: t(20),
    cancelledAt: t(20, 30),
    freeUntilHours: 24,
    lateFeePercent: 50,
    noShowFeePercent: 100,
    isNoShow: true,
    cancelledBy: 'shop',
  });
  assert.equal(o.feeCents, 5000);
  assert.equal(o.refundCents, 0);
  assert.equal(o.reason, 'no_show');
});

check('a free cancellation gives the whole deposit back', () => {
  const o = cancellationOutcome({
    totalCents: 5000,
    paidCents: 1000, // deposit only
    startsAt: t(20),
    cancelledAt: t(9) - 48 * 60 * MIN,
    freeUntilHours: 24,
    lateFeePercent: 50,
    noShowFeePercent: 100,
    isNoShow: false,
    cancelledBy: 'customer',
  });
  assert.equal(o.feeCents, 0);
  assert.equal(o.refundCents, 1000);
});

// The fee is a share of the whole ticket, but only the deposit was ever
// taken — a customer can never be refunded more than they handed over.
check('a late cancellation never refunds more than was paid', () => {
  const o = cancellationOutcome({
    totalCents: 5000,
    paidCents: 1000,
    startsAt: t(20),
    cancelledAt: t(18),
    freeUntilHours: 24,
    lateFeePercent: 50,
    noShowFeePercent: 100,
    isNoShow: false,
    cancelledBy: 'customer',
  });
  assert.equal(o.feeCents, 2500);
  assert.equal(o.refundCents, 0);
});

console.log('matching');

check('shrunk rating punishes thin review counts', () => {
  assert.ok(shrunkRating(5, 2) < shrunkRating(4.7, 300));
});

const candidate = (over: Partial<MatchCandidate>): MatchCandidate => ({
  shopId: 'x',
  distanceM: 1000,
  ratingAvg: 4.5,
  ratingCount: 100,
  priceFromCents: 4000,
  semanticSimilarity: 0.5,
  tagOverlap: 0.5,
  minutesToFirstSlot: 120,
  languagesSpoken: ['de'],
  completionRate: 0.95,
  cancellationRate: 0.02,
  isNew: false,
  isMobile: false,
  chainId: null,
  ...over,
});

check('closer, better-rated, sooner-available shop wins', () => {
  const ranked = rank(
    [
      candidate({ shopId: 'far', distanceM: 4500, ratingAvg: 4.1, minutesToFirstSlot: 4000 }),
      candidate({ shopId: 'near', distanceM: 400, ratingAvg: 4.8, minutesToFirstSlot: 90 }),
    ],
    { maxTravelM: 5000, preferredLanguages: ['de'], wantsSoon: true, personalisationConsent: true },
  );
  assert.equal(ranked[0].shopId, 'near');
  assert.ok(ranked[0].reasons.includes('free_today'));
});

check('without personalisation consent, taste signals are zeroed', () => {
  const [withConsent] = rank([candidate({ semanticSimilarity: 0.99, tagOverlap: 0.99 })], {
    maxTravelM: 5000,
    preferredLanguages: [],
    wantsSoon: false,
    personalisationConsent: true,
  });
  const [without] = rank([candidate({ semanticSimilarity: 0.99, tagOverlap: 0.99 })], {
    maxTravelM: 5000,
    preferredLanguages: [],
    wantsSoon: false,
    personalisationConsent: false,
  });
  assert.equal(withConsent.components.affinity > 0, true);
  assert.equal(without.components.affinity, 0);
  assert.ok(!without.reasons.includes('matches_your_style'));
});

check('one chain cannot own the whole first screen', () => {
  const many = Array.from({ length: 6 }, (_, i) =>
    candidate({ shopId: `chain${i}`, chainId: 'acme', distanceM: 100 + i, ratingAvg: 4.9 }),
  );
  const indie = candidate({ shopId: 'indie', chainId: null, distanceM: 900, ratingAvg: 4.4 });
  const ranked = rank([...many, indie], {
    maxTravelM: 5000,
    preferredLanguages: [],
    wantsSoon: false,
    personalisationConsent: false,
  });
  const order = ranked.map((r) => r.shopId);
  // The independent is promoted above the chain's 4th, 5th and 6th branches,
  // even though every one of them scores higher on raw distance and rating.
  assert.deepEqual(order.slice(0, 4), ['chain0', 'chain1', 'chain2', 'indie']);
  assert.deepEqual(order.slice(4).sort(), ['chain3', 'chain4', 'chain5']);
  assert.equal(ranked.length, 7); // demoted, not dropped
});

check('mobile shops survive the travel-radius filter', () => {
  const ranked = rank([candidate({ shopId: 'mob', distanceM: 20000, isMobile: true })], {
    maxTravelM: 5000,
    preferredLanguages: [],
    wantsSoon: false,
    personalisationConsent: false,
  });
  assert.equal(ranked.length, 1);
});

console.log(`\n${passed} checks passed`);
