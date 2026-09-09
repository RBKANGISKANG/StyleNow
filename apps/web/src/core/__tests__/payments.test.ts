/**
 * The payment step's gatekeepers, checked against known-good and known-bad
 * numbers: Luhn on cards (the processors' own test PANs), mod-97 on IBANs
 * (the Bundesbank example plus a corrupted copy), and what the engine records.
 */
import assert from 'node:assert/strict';
import {
  luhnValid, cardBrand, formatCardNumber, expiryValid, cvcValid,
  ibanValid, maskedCardLabel, maskedIbanLabel,
} from '../../lib/payments';
import {
  allShops, availability, createHold, confirmBooking, revenueReport,
  setLocalPersistence, effectiveStaff, setBookingStatus, dayCloseReport,
  buyGiftCard, giftCard, validateVoucher, giftCardsForShop, bookingLedger,
  myReferralCode, referralUsable, giftCardsForDevice, setCustomerMemo, getBooking,
  sendMessage, addClosure, messageThread, dayLoadForecast, dayLoadRange, shopTrust, quietWindows,
  setShopAnnouncement, shopAnnouncement, toggleVip, customersForShop,
  setShopGoal, shopGoal, sellGiftCardAtCounter, noticesForShop,
  createShopBooking, stampStatus, setStampSettings, cancelBooking, SlotTaken,
  setQuietDiscount, quietDiscountOf, cheapestSlots, suggestedAddOns, staffInsights, alternativesFor,
  rebookCadence, savedPeople, addPerson, removePerson, customerRecap, exportMyData, eraseMyData,
  shopTrust as trustOf, GOODWILL_CENTS, giftCardsForDevice as cardsOf, messageThread as threadOf, sendMessage as sendMsg,
  checkIn, addWalkIn, walkIns, convertWalkIn, setWalkInState, estimatedWaitMin, publicQueue,
  addLogEntry, ackLogEntry, logEntries, deleteLogEntry,
  saveChecklist, checklists, tickChecklistItem, checklistCompletion,
  setTechRecord, latestTechRecord,
  addCashEntry, drawerReport, deleteCashEntry, rescheduleBooking, checklistTicks as checklistTicksOf,
  staffEarningsReport, patchStaff, utilizationReport,
  setReview, reviewTagStats, recordPatchTest, patchTestValid, careProfile as careOf, setAllergies,
  setResources, resourcesOf, gapWindows, dayDriftMin, ensureConsultService, consultDone,
  joinWaitlist, waitlistForDevice,
  savePackageOffer, buyPackage, myPackages, packageRemaining, packagesForShop,
  setMembershipOffer, joinMembership, leaveMembership, giftTreatment, createGroupHold, lastMinuteDeals,
  setBirthday, setBirthdayPerk, setAccessNeeds, setAccessFacts, accessFactsOf, setWouldRepeat,
  addAvailabilityWatch, myWatches, removeAvailabilityWatch,
  addStaffPhoto, staffPhotos, saveStockItem, adjustStock, stockItems, colourServicesThisWeek,
  openDispute, resolveDispute, disputesForShop, myDisputes,
  createDuoHold, resourceRoomFor, myMembership, bookingsForDevice, effectiveServices,
  exportShopConfig, applyShopConfig, patchService, serviceOverrideEntries,
  feed, buyCorporateBatch, corporateDiscountPct, myCorporateBatches, corporateBatchesForShop,
} from '../store';
import { toCsv, eurDe } from '../../lib/csv';
import { todayIso, addDays, isoDow, dayStart, isoDateOf } from '../time';

setLocalPersistence(false);

// --- Luhn & brands (the gateways' published test numbers) --------------------

assert.ok(luhnValid('4242 4242 4242 4242'), 'Stripe’s Visa test PAN is Luhn-valid');
assert.ok(luhnValid('5555 5555 5555 4444'), 'Mastercard test PAN');
assert.ok(luhnValid('3782 822463 10005'), 'Amex test PAN');
assert.ok(!luhnValid('4242 4242 4242 4241'), 'one flipped digit must fail');
assert.ok(!luhnValid('1234'), 'too short must fail');

assert.equal(cardBrand('4242424242424242'), 'visa');
assert.equal(cardBrand('5555555555554444'), 'mastercard');
assert.equal(cardBrand('2720999999999996'), 'mastercard'); // 2-series BIN
assert.equal(cardBrand('378282246310005'), 'amex');

assert.equal(formatCardNumber('4242424242424242'), '4242 4242 4242 4242');
assert.equal(formatCardNumber('378282246310005'), '3782 822463 10005', 'Amex groups 4-6-5');
assert.equal(maskedCardLabel('4242424242424242'), 'Visa ····4242');

// --- expiry & cvc ------------------------------------------------------------

const future = new Date();
future.setFullYear(future.getFullYear() + 2);
const mmyy = `${String(future.getMonth() + 1).padStart(2, '0')}/${String(future.getFullYear() % 100).padStart(2, '0')}`;
assert.ok(expiryValid(mmyy), 'two years out is valid');
assert.ok(!expiryValid('01/20'), 'the past is not');
assert.ok(!expiryValid('13/30'), 'month 13 is not a month');
assert.ok(cvcValid('123', 'visa') && !cvcValid('12', 'visa'));
assert.ok(cvcValid('1234', 'amex') && !cvcValid('123', 'amex'), 'Amex wants four digits');

// --- IBAN mod-97 -------------------------------------------------------------

assert.ok(ibanValid('DE89 3704 0044 0532 0130 00'), 'the Bundesbank example IBAN passes');
assert.ok(ibanValid('AT61 1904 3002 3457 3201'), 'Austrian length differs and still passes');
assert.ok(!ibanValid('DE89 3704 0044 0532 0130 01'), 'a corrupted check digit fails');
assert.ok(!ibanValid('DE89 3704'), 'wrong length fails');
assert.ok(!ibanValid('XX89 3704 0044 0532 0130 00'), 'unknown country fails');
assert.equal(maskedIbanLabel('DE89 3704 0044 0532 0130 00'), 'SEPA DE··3000');

// --- the engine records the method, and revenue can group by it --------------

const [shop] = allShops();
const staff = effectiveStaff(shop.id)[0];
const svc = shop.services[0];
let iso = addDays(todayIso(), 3);
let slots: Array<{ start: number }> = [];
for (let i = 0; i < 14 && slots.length === 0; i++) {
  if ([1, 2, 3, 4, 5].includes(isoDow(dayStart(iso)))) {
    slots = availability(shop.id, [svc.id], iso, 'dev-pay', staff.id).slots;
  }
  if (slots.length === 0) iso = addDays(iso, 1);
}
assert.ok(slots.length > 0, 'fixture needs a bookable slot');

const hold = createHold({
  shopId: shop.id,
  serviceIds: [svc.id],
  staffId: staff.id,
  startsAt: slots[0].start,
  deviceId: 'dev-pay',
  guestName: 'Payer',
  idempotencyKey: 'pay-test-1',
});
const b = confirmBooking(hold.bookingId, { method: 'card', label: 'Visa ····4242' });
assert.equal(b.payment?.method, 'card');
assert.equal(b.payment?.label, 'Visa ····4242', 'only the masked label reaches the booking');

const dayIso = isoDateOf(b.startsAt);
const report = revenueReport(shop.id, dayIso, dayIso);
const cardRow = report.byMethod.find((m) => m.method === 'card');
assert.ok(cardRow && cardRow.count >= 1, 'the revenue report groups by payment method');
assert.ok(
  report.byMethod.every((m) => ['card', 'paypal', 'apple_pay', 'google_pay', 'sepa', 'at_salon'].includes(m.method)),
  'unpaid-online bookings settle at the salon',
);

// --- daily closing (Tagesabschluss) ------------------------------------------

// Complete the card booking and give a tip, then close its day.
setBookingStatus(shop.id, b.id, 'completed');
b.tipCents = 500;
const close = dayCloseReport(shop.id, isoDateOf(b.startsAt));
assert.ok(close.completedCount >= 1, 'the completed visit is counted');
assert.ok(close.grossCents >= b.quote.totalCents, 'its revenue is in the gross');
assert.ok(close.tipsCents >= 500, 'the tip is counted, outside the taxable total');
assert.ok(close.vatCents > 0, 'VAT inside the gross is stated');
const closeCard = close.byMethod.find((m) => m.method === 'card');
assert.ok(closeCard && closeCard.cents >= b.quote.totalCents + 500, 'the method split includes the tip');
assert.equal(
  close.grossCents + close.tipsCents + close.feesCents - close.refundedCents,
  close.byMethod.reduce((n, m) => n + m.cents, 0) + close.feesCents - close.refundedCents,
  'the take reconciles with the method split',
);

// --- gift cards: buy → redeem partially → balance survives, empties, refuses --

const gc = buyGiftCard(shop.id, 'dev-buyer', 5000, { toName: 'Mia', fromName: 'Ben' }, { method: 'card', label: 'Visa ····4242' });
assert.match(gc.code, /^GC-[A-Z2-9]{4}-[A-Z2-9]{4}$/, 'code uses the phone-proof alphabet');
assert.ok(!/[01OIL]/.test(gc.code.slice(3)), 'no 0/O/1/I/L in the code');

// The card validates in the voucher box, capped at the basket.
const vr = validateVoucher(gc.code, 3000);
assert.ok(vr.ok && vr.discountCents === 3000, 'a €50 card covers a €30 basket fully');

// Book with it: hold takes nothing, confirm deducts exactly the used share.
const slots2 = availability(shop.id, [svc.id], isoDateOf(b.startsAt), 'dev-buyer', staff.id).slots;
assert.ok(slots2.length > 0, 'fixture needs another slot');
const gHold = createHold({
  shopId: shop.id, serviceIds: [svc.id], staffId: staff.id, startsAt: slots2[0].start,
  deviceId: 'dev-buyer', guestName: 'Mia', voucherCode: gc.code, idempotencyKey: 'gc-test-1',
});
assert.equal(giftCard(gc.code)!.balanceCents, 5000, 'a hold must not touch the balance');
const gBooking = confirmBooking(gHold.bookingId, { method: 'card', label: 'Visa ····4242' });
const used = gBooking.giftCents!;
assert.ok(used > 0, 'the gift share is stamped on the booking');
assert.equal(giftCard(gc.code)!.balanceCents, 5000 - used, 'confirm deducts exactly the used share');
assert.equal(giftCard(gc.code)!.redemptions.length, 1);

// The shop sees the liability.
const shopView = giftCardsForShop(shop.id);
assert.ok(shopView.soldCents >= 5000 && shopView.outstandingCents >= 5000 - used);

// Drain it and the box says "empty", not "unknown".
giftCard(gc.code)!.balanceCents = 0;
const empty = validateVoucher(gc.code, 3000);
assert.ok(!empty.ok && empty.reason === 'empty_card');

// --- the accountant's ledger and its CSV dialect -----------------------------

const ledger = bookingLedger(shop.id, isoDateOf(b.startsAt), isoDateOf(b.startsAt));
const row = ledger.find((r) => r.reference === b.reference);
assert.ok(row, 'the completed booking appears in its day’s ledger');
assert.equal(row!.grossCents, b.quote.totalCents);
assert.equal(row!.netCents + row!.vatCents, row!.grossCents, 'net + VAT = gross, to the cent');
assert.equal(row!.paymentLabel, 'Visa ····4242', 'the masked method rides along');
assert.equal(row!.tipCents, 500);

assert.equal(eurDe(1234), '12,34', 'German Excel wants the decimal comma');
const csv = toCsv([['a', 'b;c', 'd"e'], ['x', 'line\nbreak', 'ü']]);
assert.ok(csv.startsWith('﻿'), 'BOM first, or umlauts shred');
assert.ok(csv.includes('"b;c"') && csv.includes('"d""e"') && csv.includes('"line\nbreak"'), 'RFC 4180 quoting');

// --- ten-features batch -------------------------------------------------------

// Referrals: a friend saves once, the referrer earns on confirm — never sooner.
const refCode = myReferralCode('dev-referrer');
assert.match(refCode, /^REF-[A-Z2-9]{4}$/);
assert.equal(myReferralCode('dev-referrer'), refCode, 'the code is stable per device');
assert.ok(!referralUsable(refCode, 'dev-referrer'), 'your own code is not a discount');
assert.ok(referralUsable(refCode, 'dev-friend'), 'a stranger may use it once');
const below = validateVoucher(refCode, 2000);
assert.ok(!below.ok && below.reason === 'min_subtotal', 'below the minimum it refuses');
const okRef = validateVoucher(refCode, 6000);
assert.ok(okRef.ok && okRef.discountCents === 500, '€5 off above the minimum');

const rSlots = availability(shop.id, [svc.id], isoDateOf(b.startsAt), 'dev-friend', staff.id).slots;
assert.ok(rSlots.length > 0, 'fixture needs a slot for the friend');
const rHold = createHold({
  shopId: shop.id, serviceIds: [svc.id], staffId: staff.id, startsAt: rSlots[0].start,
  deviceId: 'dev-friend', guestName: 'Freya', voucherCode: refCode, idempotencyKey: 'ref-t-1',
});
assert.equal(giftCardsForDevice('dev-referrer').length, 0, 'a hold earns nothing yet');
confirmBooking(rHold.bookingId, { method: 'paypal', label: 'PayPal' });
const rewards = giftCardsForDevice('dev-referrer');
assert.equal(rewards.length, 1, 'confirm grants the referrer their gift card');
assert.equal(rewards[0].balanceCents, 500);
assert.ok(!referralUsable(refCode, 'dev-friend'), 'the friend cannot use a second code');

// Customer memo: private, guarded, round-trips.
assert.throws(() => setCustomerMemo(rHold.bookingId, 'dev-intruder', 'x'), /not_yours/);
setCustomerMemo(rHold.bookingId, 'dev-friend', 'ask for the 7.1 gloss');
assert.equal(getBooking(rHold.bookingId)!.customerMemo, 'ask for the 7.1 gloss');

// Closed-shop auto-reply: exactly one per closure, with the return date.
addClosure(shop.id, { from: isoDateOf(Date.now()), to: isoDateOf(Date.now()), reason: 'Test' });
sendMessage(shop.id, 'd:dev-friend', 'customer', 'Are you open?');
sendMessage(shop.id, 'd:dev-friend', 'customer', 'Hello?');
const autoReplies = messageThread(shop.id, 'd:dev-friend').filter((m) => m.from === 'shop' && m.text.includes('🤖'));
assert.equal(autoReplies.length, 1, 'exactly one auto-reply per closure, however often they write');
assert.ok(autoReplies[0].text.includes(addDays(isoDateOf(Date.now()), 1)), 'it names the return date');

// Derived panels return sane shapes.
assert.equal(dayLoadForecast(shop.id).length, 7);

// The month calendar's heat: closures and un-rostered weekdays read -1.
{
  const range = dayLoadRange(shop.id, todayIso(), 30);
  assert.equal(range.length, 30);
  const team = effectiveStaff(shop.id);
  for (const d of range) {
    const dow = isoDow(dayStart(d.iso));
    const rostered = team.some((st) => (st.shifts[dow] ?? []).length > 0);
    if (!rostered) assert.equal(d.pct, -1, `${d.iso} has nobody rostered and must be closed`);
    else assert.ok(d.pct >= -1 && d.pct <= 100);
  }
  // the closure added earlier in this suite covers today
  assert.equal(range[0].pct, -1, 'a closure day is unbookable in the calendar');
}
const trust = shopTrust(shop.id);
assert.ok(trust.completed90 > 0 && (trust.avgRating === null || trust.avgRating <= 5));
const qw = quietWindows(shop.id);
assert.ok(qw.length > 0 && qw.every((w) => w.dow >= 1 && w.dow <= 7));
assert.ok(qw[0].count <= qw[qw.length - 1].count, 'sorted quietest first');

// Announcements round-trip and clear.
setShopAnnouncement(shop.id, '  We have AC 🧊  ');
assert.equal(shopAnnouncement(shop.id), 'We have AC 🧊');
setShopAnnouncement(shop.id, '');
assert.equal(shopAnnouncement(shop.id), '');

// --- twenty-features batch ----------------------------------------------------

// VIPs: toggled by the shop, surfaced on the customer row, reversible.
const anyCustomer = customersForShop(shop.id)[0];
assert.ok(anyCustomer, 'the seeded shop has customers');
assert.equal(toggleVip(shop.id, anyCustomer.key), true);
assert.ok(customersForShop(shop.id).find((c) => c.key === anyCustomer.key)!.vip, 'the star sticks');
assert.equal(toggleVip(shop.id, anyCustomer.key), false, 'and unsticks');

// Monthly goal: set, clamp, clear.
setShopGoal(shop.id, 1200000);
assert.equal(shopGoal(shop.id), 1200000);
setShopGoal(shop.id, 0);
assert.equal(shopGoal(shop.id), 0);

// Counter sale: a card owned by the shop's till, paid at the salon.
const counter = sellGiftCardAtCounter(shop.id, 5000, 'Walk-in');
assert.equal(counter.balanceCents, 5000);
assert.equal(counter.payment?.method, 'at_salon');
assert.ok(counter.buyerDeviceId.startsWith('shop:'), 'the till, not a customer device, holds it');

// Morning digest: today has seeded bookings → exactly one digest notice.
const digests = noticesForShop(shop.id).filter((n) => n.kind === 'digest');
assert.ok(digests.length <= 1, 'never more than one digest');
if (digests.length === 1) {
  assert.ok(Number(digests[0].preview) >= 1, 'it counts today’s appointments');
}

// --- the Stempelkarte: ten stamps, one free visit -----------------------------

// Fabricate ten completed visits inside the window for one device.
let stamped = 0;
for (let back = 7; back <= 120 && stamped < 10; back += 3) {
  const isoDay = addDays(todayIso(), -back);
  if (![1, 2, 3, 4, 5].includes(isoDow(dayStart(isoDay)))) continue;
  try {
    const past = createShopBooking(shop.id, [svc.id], staff.id, dayStart(isoDay) + 10 * 36e5, 'Stampy');
    past.deviceId = 'dev-stamp';
    stamped += 1;
  } catch (e) {
    if (!(e instanceof SlotTaken)) throw e; // a seeded block sat on 10:00 — try the next day
  }
}
assert.equal(stamped, 10, 'fixture: ten completed past visits');

const st0 = stampStatus(shop.id, 'dev-stamp');
assert.ok(st0.enabled && st0.required === 10, 'on by default, ten by default');
assert.equal(st0.stamps, 10);
assert.equal(st0.rewardsAvailable, 1, 'a full card is one free visit');

// The free visit: whole service subtotal off, engine-gated, hold reserves it.
const fSlots = availability(shop.id, [svc.id], isoDateOf(b.startsAt), 'dev-stamp', staff.id).slots;
assert.ok(fSlots.length > 0, 'fixture needs a slot for the free visit');
const fHold = createHold({
  shopId: shop.id, serviceIds: [svc.id], staffId: staff.id, startsAt: fSlots[0].start,
  deviceId: 'dev-stamp', guestName: 'Stampy', useStampReward: true, idempotencyKey: 'stamp-t-1',
});
assert.equal(fHold.quote.totalCents, 0, 'the visit is free');
assert.ok(fHold.quote.breakdown.some((l) => l.label.includes('Stempelkarte')), 'and says why');
assert.equal(stampStatus(shop.id, 'dev-stamp').rewardsAvailable, 0, 'the live hold reserves the reward');

// A second free visit in parallel must bounce — on the reward, not the seat,
// so ask availability again (it now excludes the held slot) for a free one.
const fSlots2 = availability(shop.id, [svc.id], isoDateOf(b.startsAt), 'dev-stamp', staff.id).slots;
assert.ok(fSlots2.length > 0, 'fixture needs a second free slot');
assert.throws(
  () => createHold({
    shopId: shop.id, serviceIds: [svc.id], staffId: staff.id, startsAt: fSlots2[0].start,
    deviceId: 'dev-stamp', guestName: 'Stampy', useStampReward: true, idempotencyKey: 'stamp-t-2',
  }),
  /no_stamp_reward/,
);

const fBooking = confirmBooking(fHold.bookingId);
setBookingStatus(shop.id, fBooking.id, 'completed');
const st1 = stampStatus(shop.id, 'dev-stamp');
assert.equal(st1.stamps, 10, 'the free visit itself earns no stamp');
assert.equal(st1.rewardsAvailable, 0, 'and the reward is spent');

// The shop cancelling the free visit hands the reward back — derived, not stored.
cancelBooking(fBooking.id, { preview: false, by: 'shop' });
assert.equal(stampStatus(shop.id, 'dev-stamp').rewardsAvailable, 1, 'a cancelled free visit returns the reward');

// Managed by the company: off means off, and the threshold is theirs.
setStampSettings(shop.id, { enabled: false, required: 10 });
assert.equal(stampStatus(shop.id, 'dev-stamp').enabled, false);
assert.throws(
  () => createHold({
    shopId: shop.id, serviceIds: [svc.id], staffId: staff.id, startsAt: fSlots[0].start,
    deviceId: 'dev-stamp', guestName: 'Stampy', useStampReward: true, idempotencyKey: 'stamp-t-3',
  }),
  /no_stamp_reward/,
);
setStampSettings(shop.id, { enabled: true, required: 5 });
assert.equal(stampStatus(shop.id, 'dev-stamp').rewardsAvailable, 2, 'a five-visit card doubles the rewards');

// ---------------------------------------------------------------------------
// discovery batch: flexible saver, quiet discount, add-ons, insights, nearby
// ---------------------------------------------------------------------------

// Flexible saver: at most five, cheapest first, never in the past, ≤2 per day.
const savers = cheapestSlots(shop.id, [svc.id], 'dev-flex');
assert.ok(savers.length > 0 && savers.length <= 5, 'saver list is short');
for (let i = 1; i < savers.length; i++) {
  assert.ok(savers[i].priceCents >= savers[i - 1].priceCents, 'sorted by price');
}
assert.ok(savers.every((s) => s.start > Date.now()), 'no past times');
const perDay = new Map<string, number>();
for (const s of savers) perDay.set(s.iso, (perDay.get(s.iso) ?? 0) + 1);
assert.ok([...perDay.values()].every((n) => n <= 2), 'at most two per day');

// Quiet-time discount: only in the two emptiest day-parts, badge says why.
assert.equal(quietDiscountOf(shop.id), 0, 'off by default');
setQuietDiscount(shop.id, 20);
assert.equal(quietDiscountOf(shop.id), 20);
const quiet2 = new Set(quietWindows(shop.id).slice(0, 2).map((w) => `${w.dow}:${w.part}`));
let sawQuiet = 0;
let sawLoud = 0;
// Four weeks, not one: the quiet parts may sit on a single weekday, and this
// week's instance of it can already be fully booked by the fixtures above.
for (let d = 0; d < 28; d++) {
  const iso = addDays(todayIso(), d);
  for (const s of availability(shop.id, [svc.id], iso, 'dev-quiet').slots) {
    const minute = Math.floor((s.start - dayStart(iso)) / 60000);
    const part = minute < 720 ? 'morning' : minute < 1020 ? 'afternoon' : 'evening';
    const inQuiet = quiet2.has(`${isoDow(s.start)}:${part}`);
    const badged = s.appliedNames.some((n) => n.includes('Quiet time'));
    if (inQuiet && badged) sawQuiet += 1;
    if (!inQuiet) {
      assert.ok(!badged, 'never applies outside the quiet parts');
      sawLoud += 1;
    }
  }
}
assert.ok(sawQuiet > 0, 'the discount actually lands somewhere');
assert.ok(sawLoud > 0, 'and somewhere it does not');
assert.throws(() => setQuietDiscount(shop.id, 80), /bad_percent/);
setQuietDiscount(shop.id, 0);
assert.equal(quietDiscountOf(shop.id), 0, 'off is off');

// Frequently booked together: derived from completed co-bookings only.
const twoSvc = shop.services.slice(0, 2);
if (twoSvc.length === 2) {
  const addons = suggestedAddOns(shop.id, [twoSvc[0].id]);
  for (const a of addons) {
    assert.notEqual(a.service.id, twoSvc[0].id, 'never suggests the basket itself');
    assert.ok(a.attachPct >= 10 && a.attachPct <= 100, 'an honest percentage');
  }
}
assert.deepEqual(suggestedAddOns(shop.id, []), [], 'empty basket, empty answer');

// Stylist insights: at most one leader; rebook needs a real customer base.
const ins = staffInsights(shop.id, [svc.id], 'dev-ins');
const leaders = Object.values(ins).filter((i) => i.mostBooked).length;
assert.ok(leaders <= 1, 'one leader at most');
for (const i of Object.values(ins)) {
  if (i.rebookPct !== null) assert.ok(i.rebookPct >= 0 && i.rebookPct <= 100);
}

// Fully booked here → seats elsewhere: never the same shop, three at most.
const alts = alternativesFor(shop.id, [svc.id], todayIso(), 'dev-alt');
assert.ok(alts.length <= 3);
for (const a of alts) {
  assert.notEqual(a.shopId, shop.id, 'an alternative is another shop');
  assert.ok(a.start > Date.now(), 'and a real future seat');
}

// ---------------------------------------------------------------------------
// lifecycle batch: rhythm, people, recap, privacy, goodwill
// ---------------------------------------------------------------------------

// Fixture: three completed visits of the same service, four weeks apart.
const rhythmDev = 'dev-rhythm';
const rhythmIds: string[] = [];
{
  let made = 0;
  for (let d = 1; d <= 21 && made < 4; d++) {
    const iso = addDays(todayIso(), d);
    const s = availability(shop.id, [svc.id], iso, rhythmDev, staff.id).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      const h = createHold({
        shopId: shop.id, serviceIds: [svc.id], staffId: staff.id, startsAt: s.start,
        deviceId: rhythmDev, guestName: 'Rhythm', idempotencyKey: `rhy-${made}`,
      });
      confirmBooking(h.bookingId);
      rhythmIds.push(h.bookingId);
      made += 1;
    } catch { /* seeded block — next day */ }
  }
}
assert.equal(rhythmIds.length, 4, 'fixture: four seats');
// Backdate three into a clean 28-day rhythm; the fourth stays for later.
const gaps = [84, 56, 28];
for (let i = 0; i < 3; i++) {
  const b = getBooking(rhythmIds[i])!;
  b.startsAt = Date.now() - gaps[i] * 864e5;
  b.endsAt = b.startsAt + 45 * 60000;
  setBookingStatus(shop.id, b.id, 'completed');
}

// The fourth is still a *future confirmed* booking of the same service, so
// the rhythm is answered — nothing is due.
assert.ok(!rebookCadence(rhythmDev).some((d) => d.serviceId === svc.id), 'an upcoming booking silences the nudge');

// Cancel it (customer, free window) — now the rhythm speaks.
cancelBooking(rhythmIds[3], { preview: false, by: 'customer' });
const dues = rebookCadence(rhythmDev);
const due = dues.find((d) => d.serviceId === svc.id);
assert.ok(due, 'three visits every four weeks, last one a month ago → due');
assert.ok(Math.abs(due!.medianGapDays - 28) <= 1, `median ≈ 28, got ${due!.medianGapDays}`);

// Family & friends: a person is saved, filters exist, removal sticks.
assert.equal(savedPeople(rhythmDev).length, 0);
const milo = addPerson(rhythmDev, { name: 'Milo', emoji: '🧒' });
assert.equal(savedPeople(rhythmDev)[0].name, 'Milo');
removePerson(rhythmDev, milo.id);
assert.equal(savedPeople(rhythmDev).length, 0);

// The year recap: computed, honest, local.
const recap = customerRecap(rhythmDev, new Date().getFullYear());
assert.equal(recap.visits, 3);
assert.ok(recap.spentCents > 0);
assert.equal(recap.topShop?.name, shop.name);

// Goodwill: the shop cancelling a confirmed seat on short notice mints €5.
const gwDev = 'dev-goodwill';
let gwId = '';
for (let d = 1; d <= 21 && !gwId; d++) {
  const iso = addDays(todayIso(), d);
  const s = availability(shop.id, [svc.id], iso, gwDev, staff.id).slots.find((x) => x.start > Date.now());
  if (!s) continue;
  try {
    const h = createHold({
      shopId: shop.id, serviceIds: [svc.id], staffId: staff.id, startsAt: s.start,
      deviceId: gwDev, guestName: 'Gw', idempotencyKey: 'gw-1',
    });
    confirmBooking(h.bookingId);
    gwId = h.bookingId;
  } catch { /* next day */ }
}
assert.ok(gwId, 'fixture: a confirmed seat');
const gwB = getBooking(gwId)!;
gwB.startsAt = Date.now() + 2 * 36e5; // tonight — well inside the 24 h window
gwB.endsAt = gwB.startsAt + 45 * 60000;
const cardsBefore = cardsOf(gwDev).length;
cancelBooking(gwId, { preview: false, by: 'shop' });
assert.ok(gwB.goodwill, 'the apology is automatic');
const gwCards = cardsOf(gwDev);
assert.equal(gwCards.length, cardsBefore + 1);
assert.equal(gwCards[0].balanceCents, GOODWILL_CENTS);
assert.ok(trustOf(shop.id).shopCancels90 >= 1, 'and the trust strip counts it');

// Privacy: export carries everything, erasure blanks the person, not the books.
const dump = exportMyData(rhythmDev) as { bookings: unknown[] };
assert.ok(dump.bookings.length >= 4, 'export sees all the device bookings');
sendMsg(shop.id, `d:${rhythmDev}`, 'customer', 'my number is 0171…');
const totalBefore = getBooking(rhythmIds[0])!.quote.totalCents;
const touched = eraseMyData(rhythmDev);
assert.ok(touched >= 4);
assert.equal(getBooking(rhythmIds[0])!.guestName, '—');
assert.equal(getBooking(rhythmIds[0])!.quote.totalCents, totalBefore, 'amounts survive erasure');
assert.ok(threadOf(shop.id, `d:${rhythmDev}`).every((m) => m.from !== 'customer' || m.text === '—'), 'customer texts are gone');

// ---------------------------------------------------------------------------
// shop-floor batch: check-in, walk-ins, logbook, checklists, Rezeptkarten
// ---------------------------------------------------------------------------

// Check-in: owner-only, confirmed-only, and only near the start.
{
  const ciDev = 'dev-checkin';
  let ciId = '';
  for (let d = 1; d <= 21 && !ciId; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), ciDev, staff.id).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      const h = createHold({ shopId: shop.id, serviceIds: [svc.id], staffId: staff.id, startsAt: s.start, deviceId: ciDev, guestName: 'Ci', idempotencyKey: 'ci-1' });
      confirmBooking(h.bookingId);
      ciId = h.bookingId;
    } catch { /* next day */ }
  }
  assert.ok(ciId, 'fixture: a confirmed seat');
  assert.throws(() => checkIn(ciId, ciDev), /too_early/, 'days away is not "here"');
  assert.throws(() => checkIn(ciId, 'someone-else'), /not_yours/);
  const cb = getBooking(ciId)!;
  cb.startsAt = Date.now() + 10 * 60000;
  cb.endsAt = cb.startsAt + 45 * 60000;
  checkIn(ciId, ciDev);
  assert.ok(cb.checkedInAt, 'checked in inside the window');
}

// Walk-ins: queue, honest wait, and a real seat through the real contract.
// On a fresh shop — the suite above has booked today at shop #1 solid.
{
  const shop2 = allShops()[1];
  const svc2 = shop2.services[0];
  const w = addWalkIn(shop2.id, 'Frau Weber', [svc2.id]);
  assert.equal(walkIns(shop2.id).filter((x) => x.state === 'queued').length, 1);
  assert.equal(publicQueue(shop2.id).queued, 1);
  const est = estimatedWaitMin(shop2.id);
  assert.ok(est === null || est >= 0, 'the estimate is honest: a number, or none when today is full');
  const seated = convertWalkIn(shop2.id, w.id);
  assert.ok(['confirmed', 'completed'].includes(seated.status), 'the walk-in got a real booking');
  assert.equal(walkIns(shop2.id).find((x) => x.id === w.id)!.state, 'serving');
  setWalkInState(shop2.id, w.id, 'done');
  assert.equal(publicQueue(shop2.id).queued, 0, 'an empty queue advertises no wait');
}

// Übergabebuch: pinned first, acks carry names, deletion is final.
{
  const a = addLogEntry(shop.id, staff.id, 'Farbe für Frau M. ist bestellt');
  const b2 = addLogEntry(shop.id, staff.id, 'Kasse klemmt — Schlüssel im Büro', true);
  assert.equal(logEntries(shop.id)[0].id, b2.id, 'pinned floats to the top');
  ackLogEntry(shop.id, a.id, staff.id);
  ackLogEntry(shop.id, a.id, staff.id);
  assert.deepEqual(logEntries(shop.id).find((e) => e.id === a.id)!.ackBy, [staff.id], 'acks are idempotent');
  deleteLogEntry(shop.id, a.id);
  deleteLogEntry(shop.id, b2.id);
  assert.equal(logEntries(shop.id).length, 0);
}

// Checklists: written once, ticked daily, and the Tagesabschluss knows.
{
  const tpl = saveChecklist(shop.id, { kind: 'closing', items: [{ id: '', label: 'Kasse zählen' }, { id: '', label: 'Licht aus' }] });
  assert.equal(checklists(shop.id).length, 1);
  const iso = todayIso();
  assert.equal(dayCloseReport(shop.id, iso).checklistsComplete, false, 'nothing ticked yet');
  for (const item of tpl.items) tickChecklistItem(shop.id, iso, item.id, staff.id);
  assert.equal(dayCloseReport(shop.id, iso).checklistsComplete, true, 'all ticked');
  const comp = checklistCompletion(shop.id, iso);
  assert.equal(comp[0].done, 2);
  tickChecklistItem(shop.id, iso, tpl.items[0].id, staff.id); // untick
  assert.equal(dayCloseReport(shop.id, iso).checklistsComplete, false, 'unticking reopens the day');
}

// Rezeptkarten: written on the visit, found via the customer, newest wins.
{
  // no phone on the fixture → the customer key is the device key
  const key = 'd:dev-rhythm';
  setTechRecord(shop.id, rhythmIds[0], { formula: '7.1 + 30vol', processingMin: 35, byStaffId: staff.id });
  setTechRecord(shop.id, rhythmIds[1], { formula: '7.13 + 20vol', byStaffId: staff.id });
  const latest = latestTechRecord(shop.id, key);
  assert.equal(latest!.record.formula, '7.13 + 20vol', 'the newest card wins');
  assert.throws(() => setTechRecord(shop.id, rhythmIds[0], { formula: '', byStaffId: staff.id }), /bad_formula/);
}

// ---------------------------------------------------------------------------
// records & reports batch: Kassenbuch, commission, utilization, tags, care
// ---------------------------------------------------------------------------

// Kassenbuch: float in, expenses out, and the Differenz once counted.
{
  const iso = todayIso();
  addCashEntry(shop.id, iso, { kind: 'float', amountCents: 15000 });
  addCashEntry(shop.id, iso, { kind: 'expense', amountCents: 1200, note: 'Kaffee' });
  const before = drawerReport(shop.id, iso);
  assert.equal(before.countedCents, null, 'not counted yet');
  const baseline = before.expectedCents;
  addCashEntry(shop.id, iso, { kind: 'count', amountCents: baseline - 500 });
  const after = drawerReport(shop.id, iso);
  assert.equal(after.differenceCents, -500, 'the drawer is €5 short and says so');
  assert.throws(() => addCashEntry(shop.id, iso, { kind: 'expense', amountCents: -100 }), /bad_amount/);
  const cnt = after.entries.find((e) => e.kind === 'count')!;
  deleteCashEntry(shop.id, iso, cnt.id);
  assert.equal(drawerReport(shop.id, iso).differenceCents, null, 'deleting the count reopens it');
}

// Provisionsabrechnung: revenue × percent, tips never commissioned.
{
  patchStaff(shop.id, staff.id, { commissionPercent: 30 });
  const rows = staffEarningsReport(shop.id, addDays(todayIso(), -120), todayIso());
  const mine = rows.find((r) => r.staffId === staff.id)!;
  assert.ok(mine.serviceCents > 0, 'the fixture months earned something');
  assert.equal(mine.commissionCents, Math.round((mine.serviceCents * 30) / 100));
  const other = rows.find((r) => r.commissionPercent === 0);
  if (other) assert.equal(other.commissionCents, 0, 'no percent, no commission');
}

// Utilization: capacity grid is bounded, per-chair-hour is derived.
{
  const ut = utilizationReport(shop.id, addDays(todayIso(), -27), todayIso());
  assert.equal(ut.grid.length, 21, '7 days × 3 parts');
  for (const g of ut.grid) if (g.bookedPct !== null) assert.ok(g.bookedPct >= 0 && g.bookedPct <= 100);
  assert.ok(ut.services.length > 0, 'the fixtures booked services');
  for (const s of ut.services) assert.ok(s.perChairHourCents >= 0);
}

// Review tags: countable, per stylist, bogus tags dropped.
{
  const done = getBooking(rhythmIds[0])!;
  setReview(done.id, 5, 'wunderbar', ['on_time', 'great_result', 'nope' as never]);
  const stats = reviewTagStats(shop.id);
  assert.ok((stats.total.on_time ?? 0) >= 1);
  assert.ok((stats.byStaff[done.staffId]?.great_result ?? 0) >= 1);
  assert.equal(done.review!.tags!.length, 2, 'the invented tag never landed');
}

// Patch-test passport: the flag rides the hold until a test is recorded.
{
  const dev = 'dev-patch';
  const flagged = shop.services.find((s) => s.requiresPatchTest)!;
  assert.ok(flagged, 'seed carries flagged colour services');
  assert.equal(patchTestValid(dev, shop.id), false);
  let held: string = '';
  for (let d = 1; d <= 21 && !held; d++) {
    const s = availability(shop.id, [flagged.id], addDays(todayIso(), d), dev).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      held = createHold({ shopId: shop.id, serviceIds: [flagged.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'Pt', idempotencyKey: 'pt-1' }).bookingId;
    } catch { /* next day */ }
  }
  assert.ok(held, 'fixture: a colour hold');
  assert.equal(getBooking(held)!.needsPatchTest, true, 'no test on file → the floor sees it');
  recordPatchTest(dev, shop.id);
  assert.equal(patchTestValid(dev, shop.id), true);
  setAllergies(dev, ['PPD', '  ', 'Ammoniak']);
  assert.deepEqual(careOf(dev).allergies, ['PPD', 'Ammoniak'], 'blanks are dropped');
}

// ---------------------------------------------------------------------------
// regressions the adversarial review caught
// ---------------------------------------------------------------------------

// Drawer: a counter gift sale is cash in the drawer; an online one is not.
{
  const iso = todayIso();
  const before = drawerReport(shop.id, iso).expectedCents;
  sellGiftCardAtCounter(shop.id, 2500, 'Bar-Kundin');
  assert.equal(drawerReport(shop.id, iso).expectedCents, before + 2500, 'counter sale lands in expected cash');
  buyGiftCard(shop.id, 'dev-online', 3000, {}, { method: 'card', label: 'Visa ····4242' });
  assert.equal(drawerReport(shop.id, iso).expectedCents, before + 2500, 'online sale does not');
}

// Goodwill: moving tonight's seat to NEXT WEEK is the big rug-pull — it mints.
{
  const dev = 'dev-bigmove';
  let id = '';
  for (let d = 1; d <= 21 && !id; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), dev, staff.id).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      const h = createHold({ shopId: shop.id, serviceIds: [svc.id], staffId: staff.id, startsAt: s.start, deviceId: dev, guestName: 'Bm', idempotencyKey: 'bm-1' });
      confirmBooking(h.bookingId);
      id = h.bookingId;
    } catch { /* next day */ }
  }
  const b = getBooking(id)!;
  b.startsAt = Date.now() + 3 * 36e5; // tonight
  b.endsAt = b.startsAt + 45 * 60000;
  // find a seat far out and move the booking there
  let moved = false;
  for (let d = 25; d <= 40 && !moved; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), dev, staff.id).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      rescheduleBooking(shop.id, id, s.start, staff.id);
      moved = true;
    } catch { /* next day */ }
  }
  assert.ok(moved, 'fixture: the move happened');
  assert.ok(b.goodwill, 'a late move far out still ruined tonight — voucher minted');
  // and the trust strip counts it against the RUINED slot, not the new one
  assert.ok(trustOf(shop.id).lateMoves90 >= 1);
}

// Tagesabschluss: a weekly list ticked another day must not reopen today.
{
  saveChecklist(shop.id, { kind: 'weekly', items: [{ id: '', label: 'Fenster putzen' }] });
  const iso = todayIso();
  assert.equal(dayCloseReport(shop.id, iso).checklistsComplete, false, 'the closing list from earlier was unticked again');
  // re-tick the closing list fully → complete despite the untouched weekly one
  const closing = checklists(shop.id).find((c) => c.kind === 'closing')!;
  const ticked = new Set(checklistTicksOf(shop.id, iso).map((tk) => tk.itemId));
  for (const item of closing.items) if (!ticked.has(item.id)) tickChecklistItem(shop.id, iso, item.id, staff.id);
  assert.equal(dayCloseReport(shop.id, iso).checklistsComplete, true, 'weekly lists never gate the day-close');
}

// Walk-in: a double tap on "seat now" books once, not twice.
{
  const shop2 = allShops()[1];
  const w2 = addWalkIn(shop2.id, 'Doppel', [shop2.services[0].id]);
  convertWalkIn(shop2.id, w2.id);
  assert.throws(() => convertWalkIn(shop2.id, w2.id), /already_seated/);
  setWalkInState(shop2.id, w2.id, 'done');
}

// Privacy: erasure kills the care profile; export carries it while it lives.
{
  const dev = 'dev-care-erase';
  setAllergies(dev, ['PPD']);
  recordPatchTest(dev, shop.id);
  const dump = exportMyData(dev) as { careProfile: { allergies: string[] } };
  assert.deepEqual(dump.careProfile.allergies, ['PPD'], 'export includes health data');
  eraseMyData(dev);
  assert.deepEqual(careOf(dev).allergies, [], 'erasure removes it');
  assert.equal(patchTestValid(dev, shop.id), false);
}

// Family bookings: the owner's patch test never vouches for Milo's skin.
{
  const dev = 'dev-family-pt';
  recordPatchTest(dev, shop.id);
  const flagged = shop.services.find((s) => s.requiresPatchTest)!;
  const milo2 = addPerson(dev, { name: 'Milo' });
  let id = '';
  for (let d = 1; d <= 21 && !id; d++) {
    const s = availability(shop.id, [flagged.id], addDays(todayIso(), d), dev).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      id = createHold({ shopId: shop.id, serviceIds: [flagged.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'M', forPersonId: milo2.id, idempotencyKey: 'fpt-1' }).bookingId;
    } catch { /* next day */ }
  }
  assert.equal(getBooking(id)!.needsPatchTest, true, 'booking for a saved person always flags');
}

// ---------------------------------------------------------------------------
// scheduling core batch: auto-offers, resources, gaps, drift, consultation
// ---------------------------------------------------------------------------

// Auto waitlist offer: a cancellation hands the exact freed start to the
// first person waiting for that day.
{
  const shop3 = allShops()[2];
  const svc3 = shop3.services[0];
  let heldId = '';
  let heldStart = 0;
  for (let d = 1; d <= 21 && !heldId; d++) {
    const s = availability(shop3.id, [svc3.id], addDays(todayIso(), d), 'dev-freed', null).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      const h = createHold({ shopId: shop3.id, serviceIds: [svc3.id], staffId: null, startsAt: s.start, deviceId: 'dev-freed', guestName: 'F', idempotencyKey: 'ao-1' });
      confirmBooking(h.bookingId);
      heldId = h.bookingId;
      heldStart = s.start;
    } catch { /* next day */ }
  }
  assert.ok(heldId, 'fixture: a confirmed seat');
  joinWaitlist('dev-waiting', shop3.id, [svc3.id], isoDateOf(heldStart));
  cancelBooking(heldId, { preview: false, by: 'customer' });
  const wl = waitlistForDevice('dev-waiting');
  assert.ok(wl.some((w) => w.offer?.startsAt === heldStart), 'the freed slot was offered automatically');
}

// Resources: two colour chairs booked, a third colour slot must not exist.
{
  const shop4 = allShops()[0];
  setResources(shop4.id, { basins: 0, colourStations: 1 });
  assert.equal(resourcesOf(shop4.id)!.colourStations, 1);
  const colourSvc = shop4.services.find((s) => s.resource === 'colour')!;
  // find a day with at least one colour slot, book it, then the same window
  // must vanish for a second colour booking (any stylist)
  let booked: { start: number; iso: string } | null = null;
  for (let d = 1; d <= 21 && !booked; d++) {
    const iso = addDays(todayIso(), d);
    const s = availability(shop4.id, [colourSvc.id], iso, 'dev-res-1', null).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      const h = createHold({ shopId: shop4.id, serviceIds: [colourSvc.id], staffId: null, startsAt: s.start, deviceId: 'dev-res-1', guestName: 'R1', idempotencyKey: 'res-1' });
      confirmBooking(h.bookingId);
      booked = { start: s.start, iso };
    } catch { /* next day */ }
  }
  assert.ok(booked, 'fixture: one colour seat taken');
  const again = availability(shop4.id, [colourSvc.id], booked!.iso, 'dev-res-2', null).slots;
  assert.ok(!again.some((s) => s.start === booked!.start), 'the single colour station is not sold twice');
  setResources(shop4.id, { basins: 0, colourStations: 0 });
  const freeAgain = availability(shop4.id, [colourSvc.id], booked!.iso, 'dev-res-2', null).slots;
  assert.ok(freeAgain.length >= again.length, 'untracking releases the constraint');
}

// Einwirkzeit: a colour booking with a processing gap lists a sellable gap.
{
  const shop5 = allShops()[0];
  const gapSvc = shop5.services.find((s) => s.processingGapMin >= 20)!;
  let iso = '';
  for (let d = 1; d <= 21 && !iso; d++) {
    const dayIso = addDays(todayIso(), d);
    const s = availability(shop5.id, [gapSvc.id], dayIso, 'dev-gap', null).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      const h = createHold({ shopId: shop5.id, serviceIds: [gapSvc.id], staffId: null, startsAt: s.start, deviceId: 'dev-gap', guestName: 'G', idempotencyKey: 'gap-1' });
      confirmBooking(h.bookingId);
      iso = dayIso;
    } catch { /* next day */ }
  }
  assert.ok(iso, 'fixture: a colour booking');
  const gaps = gapWindows(shop5.id, iso);
  assert.ok(gaps.length >= 1, 'its Einwirkzeit shows as a sellable gap');
  assert.ok(gaps[0].end - gaps[0].start >= 15 * 60000);
}

// Drift: a confirmed booking past its end that nobody marked done = late day.
{
  const b = getBooking(rhythmIds[1])!; // completed → no drift from this one
  assert.ok(dayDriftMin(shop.id) >= 0);
  const drifted = getBooking(rhythmIds[2])!;
  const was = { status: drifted.status, startsAt: drifted.startsAt, endsAt: drifted.endsAt };
  drifted.status = 'confirmed';
  drifted.startsAt = Date.now() - 60 * 60000;
  drifted.endsAt = Date.now() - 25 * 60000;
  assert.ok(dayDriftMin(shop.id) >= 25, 'an unfinished seat 25 min past its end reads as drift');
  drifted.status = was.status as typeof drifted.status;
  drifted.startsAt = was.startsAt;
  drifted.endsAt = was.endsAt;
  void b;
}

// Consultation-first: flagged, until any completed visit answers it.
{
  const cSvc = shop.services.find((s) => s.consultationFirst)!;
  assert.ok(cSvc, 'seed carries consultation-first services');
  assert.equal(consultDone('dev-fresh-consult', shop.id), false);
  assert.equal(consultDone(rhythmDev, shop.id), true, 'a completed visit IS a conversation');
  const consult = ensureConsultService(shop.id);
  assert.equal(consult.basePriceCents, 0);
  assert.equal(ensureConsultService(shop.id).id, consult.id, 'created once, found after');
  let held = '';
  for (let d = 1; d <= 21 && !held; d++) {
    const s = availability(shop.id, [cSvc.id], addDays(todayIso(), d), 'dev-fresh-consult', null).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      held = createHold({ shopId: shop.id, serviceIds: [cSvc.id], staffId: null, startsAt: s.start, deviceId: 'dev-fresh-consult', guestName: 'C', idempotencyKey: 'cf-1' }).bookingId;
    } catch { /* next day */ }
  }
  assert.equal(getBooking(held)!.needsConsult, true, 'the floor sees the missing conversation');
}

// ---------------------------------------------------------------------------
// money products batch: packages, membership, treatment gifts, groups, deals
// ---------------------------------------------------------------------------

// 5er-Karte: prepaid, derived uses, no double-spend, cancellation refunds a use.
{
  const dev = 'dev-pack';
  const offer = savePackageOffer(shop.id, { serviceId: svc.id, count: 5, priceCents: svc.basePriceCents * 4 });
  const pk = buyPackage(shop.id, offer.id, dev, { method: 'card', label: 'Visa ····4242' });
  assert.equal(packageRemaining(pk), 5);
  let held = '';
  for (let d = 1; d <= 21 && !held; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), dev, staff.id).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      held = createHold({ shopId: shop.id, serviceIds: [svc.id], staffId: staff.id, startsAt: s.start, deviceId: dev, guestName: 'Pk', usePackageId: pk.id, idempotencyKey: 'pk-1' }).bookingId;
    } catch { /* next day */ }
  }
  const b2 = getBooking(held)!;
  assert.equal(b2.quote.totalCents, 0, 'a card visit costs nothing at checkout');
  assert.equal(packageRemaining(pk), 4, 'the live hold reserves a use');
  confirmBooking(held);
  cancelBooking(held, { preview: false, by: 'customer' });
  assert.equal(packageRemaining(pk), 5, 'a cancelled visit returns the use — derived, not stored');
  {
    // a real free slot for a two-service basket — the mismatch must come from
    // the card gate, not from the seat check
    let two: number | null = null;
    let twoIso = '';
    for (let d = 1; d <= 21 && !two; d++) {
      const iso = addDays(todayIso(), d);
      const s = availability(shop.id, [svc.id, shop.services[1].id], iso, dev, null).slots.find((x) => x.start > Date.now());
      if (s) {
        two = s.start;
        twoIso = iso;
      }
    }
    assert.ok(two, 'fixture: a two-service slot exists');
    void twoIso;
    assert.throws(
      () => createHold({ shopId: shop.id, serviceIds: [svc.id, shop.services[1].id], staffId: null, startsAt: two!, deviceId: dev, guestName: 'Pk', usePackageId: pk.id, idempotencyKey: 'pk-2' }),
      /package_mismatch/,
      'a card pays for exactly its service, nothing else',
    );
  }
  assert.ok(myPackages(dev)[0].remaining === 5);
  assert.ok(packagesForShop(shop.id).outstandingUses >= 5, 'the liability view counts open visits');
}

// Membership: the club discount rides every quote as its own line.
{
  const dev = 'dev-club';
  setMembershipOffer(shop.id, { priceCents: 1490, discountPct: 10 });
  joinMembership(dev, shop.id);
  let held = '';
  for (let d = 1; d <= 21 && !held; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), dev, staff.id).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      held = createHold({ shopId: shop.id, serviceIds: [svc.id], staffId: staff.id, startsAt: s.start, deviceId: dev, guestName: 'Cl', idempotencyKey: 'mb-1' }).bookingId;
    } catch { /* next day */ }
  }
  const b3 = getBooking(held)!;
  assert.ok(b3.quote.breakdown.some((l) => l.label.startsWith('Membership')), 'the perk is visible on the quote');
  assert.ok(b3.quote.discountCents > 0);
  leaveMembership(dev, shop.id);
}

// Gift a treatment: the card's value IS the named service.
{
  const card = giftTreatment(shop.id, 'dev-gifter', svc.id, { toName: 'Mia' }, { method: 'card', label: 'Visa ····4242' });
  assert.equal(card.balanceCents, svc.basePriceCents);
  assert.equal(card.serviceId, svc.id);
  assert.ok(card.serviceName);
}

// Group: three friends, three distinct chairs, all-or-nothing.
{
  const dev = 'dev-group';
  let seats: ReturnType<typeof createGroupHold> | null = null;
  for (let d = 1; d <= 28 && !seats; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), dev, null).slots.find(
      (x) => x.start > Date.now() && x.staffIds.length >= 3,
    );
    if (!s) continue;
    try {
      seats = createGroupHold(
        { shopId: shop.id, serviceIds: [svc.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'Orga', idempotencyKey: 'grp-1' },
        ['Mia', 'Ben'],
      );
    } catch { /* next day */ }
  }
  assert.ok(seats, 'a trio found a minute with three chairs');
  assert.equal(seats!.length, 3);
  const staffIds = new Set(seats!.map((r) => getBooking(r.bookingId)!.staffId));
  assert.equal(staffIds.size, 3, 'three different stylists');
  const groupId = getBooking(seats![0].bookingId)!.duoId;
  assert.ok(seats!.every((r) => getBooking(r.bookingId)!.duoId === groupId), 'one shared group id');
}

// Deal board: only genuine discounts, never the past, capped and sorted.
{
  const deals = lastMinuteDeals('dev-deals');
  assert.ok(deals.length <= 12);
  for (const d of deals) {
    assert.ok(d.priceCents < d.basePriceCents, 'a deal is a real discount');
    assert.ok(d.start > Date.now(), 'and a real future seat');
    assert.ok(d.offPct >= 10);
  }
  for (let i = 1; i < deals.length; i++) assert.ok(deals[i].offPct <= deals[i - 1].offPct, 'best first');
}

// ---------------------------------------------------------------------------
// care & safety batch: minors, birthday, access, journal
// ---------------------------------------------------------------------------

// Minors: guardian required, chemistry refused outright.
{
  const dev = 'dev-minor';
  const flagged = shop.services.find((s) => s.requiresPatchTest)!;
  assert.throws(
    () => createHold({ shopId: shop.id, serviceIds: [svc.id], staffId: null, startsAt: Date.now() + 864e5, deviceId: dev, guestName: 'Kid', forMinor: true, idempotencyKey: 'mn-0' }),
    /guardian_required/,
  );
  assert.throws(
    () => createHold({ shopId: shop.id, serviceIds: [flagged.id], staffId: null, startsAt: Date.now() + 864e5, deviceId: dev, guestName: 'Kid', forMinor: true, guardianName: 'Mama Weber', idempotencyKey: 'mn-1' }),
    /minor_chemical/,
  );
  let held = '';
  for (let d = 1; d <= 21 && !held; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), dev, null).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      held = createHold({ shopId: shop.id, serviceIds: [svc.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'Kid', forMinor: true, guardianName: 'Mama Weber', idempotencyKey: 'mn-2' }).bookingId;
    } catch { /* next day */ }
  }
  assert.equal(getBooking(held)!.minor!.guardianName, 'Mama Weber', 'a cut for a kid books, with the adult named');
}

// Birthday club: the perk applies itself inside the window, only there.
{
  const dev = 'dev-bday';
  const inWindow = new Date(Date.now() + 3 * 864e5);
  setBirthday(dev, `${String(inWindow.getMonth() + 1).padStart(2, '0')}-${String(inWindow.getDate()).padStart(2, '0')}`);
  setBirthdayPerk(shop.id, 15);
  let held = '';
  for (let d = 1; d <= 10 && !held; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), dev, null).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      held = createHold({ shopId: shop.id, serviceIds: [svc.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'B', idempotencyKey: 'bd-1' }).bookingId;
    } catch { /* next day */ }
  }
  const bb = getBooking(held)!;
  assert.ok(bb.birthdayPerk, 'the window found the visit');
  assert.ok(bb.quote.breakdown.some((l) => l.label.includes('Birthday')));
  setBirthdayPerk(shop.id, 0);
}

// Access: the profile writes itself onto the booking; the shop states facts.
{
  const dev = 'dev-access';
  setAccessNeeds(dev, { wheelchair: true, extraTime: true, note: 'Assistenzhund dabei' });
  let held = '';
  for (let d = 1; d <= 10 && !held; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), dev, null).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      held = createHold({ shopId: shop.id, serviceIds: [svc.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'A', idempotencyKey: 'ax-1' }).bookingId;
    } catch { /* next day */ }
  }
  const ab = getBooking(held)!;
  assert.ok(ab.access!.wheelchair && ab.access!.note!.includes('Assistenzhund'), 'the floor reads the needs');
  setAccessFacts(shop.id, { stepFree: true, wheelchairWC: false, quietCorner: true });
  assert.equal(accessFactsOf(shop.id)!.stepFree, true);
}

// Journal: only the owner pins, only completed visits.
{
  assert.throws(() => setWouldRepeat(rhythmIds[0], 'stranger', true), /not_yours/);
  const pinned = setWouldRepeat(rhythmIds[0], rhythmDev, true);
  assert.equal(pinned.wouldRepeat, true);
}

// ---------------------------------------------------------------------------
// discovery & ops batch: watches, portfolios, stock, disputes
// ---------------------------------------------------------------------------

// Watch: a standing constraint that reports its first genuine hit.
{
  const dev = 'dev-watch';
  const w = addAvailabilityWatch(dev, shop.id, svc.id, staff.id, null);
  const mine = myWatches(dev);
  assert.equal(mine.length, 1);
  const hit = mine[0].hit;
  if (hit) {
    const real = availability(shop.id, [svc.id], hit.iso, dev, staff.id).slots.some((s) => s.start === hit.start);
    assert.ok(real, 'a reported hit is a genuinely bookable slot');
  }
  removeAvailabilityWatch(dev, w.id);
  assert.equal(myWatches(dev).length, 0);
}

// Portfolio: capped at six, images only.
{
  addStaffPhoto(shop.id, staff.id, 'data:image/png;base64,iVBOR', 'Balayage im Herbstlicht');
  assert.equal(staffPhotos(staff.id).length, 1);
  assert.throws(() => addStaffPhoto(shop.id, staff.id, 'https://example.com/x.png'), /bad_image/);
}

// Stock: levels never go negative; the depletion hint is derived.
{
  const item = saveStockItem(shop.id, { name: 'Blondor 800g', level: 2, reorderAt: 2 });
  adjustStock(shop.id, item.id, -5);
  assert.equal(stockItems(shop.id).find((x) => x.id === item.id)!.level, 0, 'the shelf never holds −3 tubes');
  assert.ok(colourServicesThisWeek(shop.id) >= 0);
}

// Disputes: one open per booking, the goodwill answer mints the voucher.
{
  const done = getBooking(rhythmIds[1])!;
  const d = openDispute(done.id, rhythmDev, 'result', 'Der Ton ist viel zu warm geraten.');
  assert.throws(() => openDispute(done.id, rhythmDev, 'fee', 'noch eins'), /already_open/);
  assert.equal(disputesForShop(shop.id).find((x) => x.id === d.id)!.status, 'open');
  const cardsBefore = cardsOf(rhythmDev).length;
  resolveDispute(shop.id, d.id, { kind: 'goodwill' });
  assert.equal(myDisputes(rhythmDev)[0].status, 'resolved');
  assert.equal(cardsOf(rhythmDev).length, cardsBefore + 1, 'the apology is money, not words');
}

// ---------------------------------------------------------------------------
// review-fix regressions (round 2): money clamps, group atomicity, peak
// concurrency, privacy completeness, sync merges
// ---------------------------------------------------------------------------

// Gift card + membership: the card only covers what is still owed after the
// percentage perk — the prepaid value must not silently over-debit. And on a
// duo, the perk stays on the organizer's seat.
{
  const dev = 'dev-clamp';
  setMembershipOffer(shop.id, { priceCents: 900, discountPct: 20 });
  joinMembership(dev, shop.id);
  const card = buyGiftCard(shop.id, dev, 20000);
  let held = '';
  for (let d = 1; d <= 21 && !held; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), dev, null).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      held = createHold({ shopId: shop.id, serviceIds: [svc.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'C', voucherCode: card.code, idempotencyKey: 'clamp-1' }).bookingId;
    } catch { /* next day */ }
  }
  assert.ok(held, 'fixture: a member visit paid by gift card');
  const cb = getBooking(held)!;
  const cut = Math.round((cb.quote.subtotalCents * 20) / 100);
  assert.ok(cb.quote.breakdown.some((l) => l.key === 'ln_membership'), 'the perk applied');
  assert.equal(cb.giftCents, cb.quote.subtotalCents - cut, 'the card covers the discounted bill, not the gross one');
  assert.equal(cb.quote.totalCents, 0);
  confirmBooking(held);
  assert.equal(giftCard(card.code)!.balanceCents, 20000 - (cb.quote.subtotalCents - cut), 'no prepaid cent vanished');

  // Organizer-only: the friend's seat shares the device, not the perk.
  let pair: ReturnType<typeof createDuoHold> | null = null;
  for (let d = 1; d <= 21 && !pair; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), dev, null).slots.find(
      (x) => x.start > Date.now() && x.staffIds.length >= 2,
    );
    if (!s) continue;
    try {
      pair = createDuoHold(
        { shopId: shop.id, serviceIds: [svc.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'C', idempotencyKey: `clamp-duo-${d}` },
        'Mira',
      );
    } catch { /* next day */ }
  }
  assert.ok(pair, 'fixture: a member duo');
  assert.ok(getBooking(pair!.first.bookingId)!.quote.breakdown.some((l) => l.key === 'ln_membership'));
  assert.ok(
    !getBooking(pair!.second.bookingId)!.quote.breakdown.some((l) => l.key === 'ln_membership'),
    'the friend does not ride the membership',
  );
  leaveMembership(dev, shop.id);
  setMembershipOffer(shop.id, null);
}

// Duo strips the 5er-Karte: one duo visit costs one prepaid use, and the
// friend's seat pays its own way.
{
  const dev = 'dev-duo-pk';
  const offer = savePackageOffer(shop.id, { serviceId: svc.id, count: 5, priceCents: 9900 });
  const pk = buyPackage(shop.id, offer.id, dev);
  let pair: ReturnType<typeof createDuoHold> | null = null;
  for (let d = 1; d <= 21 && !pair; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), dev, null).slots.find(
      (x) => x.start > Date.now() && x.staffIds.length >= 2,
    );
    if (!s) continue;
    try {
      pair = createDuoHold(
        { shopId: shop.id, serviceIds: [svc.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'D', usePackageId: pk.id, idempotencyKey: `duopk-${d}` },
        'Jo',
      );
    } catch { /* next day */ }
  }
  assert.ok(pair, 'fixture: a duo on a card');
  assert.equal(getBooking(pair!.first.bookingId)!.quote.totalCents, 0, 'the organizer rides the card');
  assert.ok(getBooking(pair!.second.bookingId)!.quote.totalCents > 0, 'the friend pays normally');
  assert.equal(packageRemaining(pk), 4, 'one visit, one use — not two');

  // No-show keeps the use spent: a prepaid card is not free stand-up licence.
  let held2 = '';
  for (let d = 1; d <= 21 && !held2; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), dev, null).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      held2 = createHold({ shopId: shop.id, serviceIds: [svc.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'D', usePackageId: pk.id, idempotencyKey: `duopk-ns-${d}` }).bookingId;
    } catch { /* next day */ }
  }
  assert.ok(held2, 'fixture: another card visit');
  confirmBooking(held2);
  const before = packageRemaining(pk);
  setBookingStatus(shop.id, held2, 'no_show');
  assert.equal(packageRemaining(pk), before, 'the no-show does not refund the use');
}

// Group atomicity: when the basin count refuses a later seat, the earlier
// seats dissolve — no orphan holds poisoning the grid.
{
  const bsShop = allShops().find((x) => x.services.some((s) => s.resource === 'basin'))!;
  const basinSvc = bsShop.services.find((s) => s.resource === 'basin')!;
  setResources(bsShop.id, { basins: 1, colourStations: 0 });
  const dev = 'dev-grp-roll';
  let attempted = false;
  for (let d = 1; d <= 21 && !attempted; d++) {
    const s = availability(bsShop.id, [basinSvc.id], addDays(todayIso(), d), dev, null).slots.find(
      (x) => x.start > Date.now() && x.staffIds.length >= 3,
    );
    if (!s) continue;
    attempted = true;
    assert.throws(
      () =>
        createGroupHold(
          { shopId: bsShop.id, serviceIds: [basinSvc.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'G', idempotencyKey: `grpb-${d}` },
          ['Anna', 'Ben'],
        ),
      SlotTaken,
      'one basin cannot seat a party of three',
    );
  }
  assert.ok(attempted, 'fixture: a group attempt on a basin service');
  assert.equal(bookingsForDevice(dev).length, 0, 'the failed group left no orphan seats behind');
  setResources(bsShop.id, { basins: 0, colourStations: 0 });
}

// Peak, not count: two strictly sequential colour seats are one station at a
// time — a window spanning both must still find room; simultaneous seats
// fill the house.
{
  const sh = allShops()[0];
  const colourSvc = sh.services.find((s) => s.resource === 'colour')!;
  setResources(sh.id, { basins: 0, colourStations: 2 });
  const dev = 'dev-peak';
  const ids: string[] = [];
  for (let d = 1; d <= 21 && ids.length < 2; d++) {
    for (const s of availability(sh.id, [colourSvc.id], addDays(todayIso(), d), dev, null).slots) {
      if (ids.length >= 2 || s.start <= Date.now()) continue;
      try {
        const h = createHold({ shopId: sh.id, serviceIds: [colourSvc.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'P', idempotencyKey: `peak-${ids.length}` });
        confirmBooking(h.bookingId);
        ids.push(h.bookingId);
      } catch { /* taken */ }
    }
  }
  assert.equal(ids.length, 2, 'fixture: two colour seats');
  const A = getBooking(ids[0])!;
  const B = getBooking(ids[1])!;
  // test-only surgery (same licence the drift block takes): park both far
  // outside the seeded horizon, strictly back to back
  const T = dayStart(addDays(todayIso(), 40)) + 10 * 3600_000;
  const park = (b: typeof A, start: number) => {
    const shift = start - b.startsAt;
    b.startsAt += shift;
    b.endsAt += shift;
    b.staffRanges = b.staffRanges.map((r) => ({ start: r.start + shift, end: r.end + shift }));
  };
  park(A, T);
  // B begins the instant A's last occupied range ends (the finish segment can
  // outlive endsAt, so "after A" means after its ranges, not after endsAt)
  const aEnd = Math.max(A.endsAt, ...A.staffRanges.map((r) => r.end));
  park(B, aEnd);
  assert.equal(
    resourceRoomFor(sh.id, [colourSvc.id], T + 60000, aEnd + 60000),
    1,
    'sequential seats are one station, not two',
  );
  park(B, T); // now truly simultaneous
  assert.equal(resourceRoomFor(sh.id, [colourSvc.id], T + 60000, T + 30 * 60000), 0, 'simultaneous seats fill both stations');
  setResources(sh.id, { basins: 0, colourStations: 0 });
}

// Reschedule obeys the bottleneck: the front desk cannot move a colour seat
// onto a window where the only station is taken.
{
  const sh = allShops()[0];
  const colourSvc = sh.services.find((s) => s.resource === 'colour')!;
  const dev = 'dev-res-move';
  let target: { start: number; staffIds: string[] } | null = null;
  let aId = '';
  let cId = '';
  for (let d = 1; d <= 21 && !cId; d++) {
    const day = availability(sh.id, [colourSvc.id], addDays(todayIso(), d), dev, null).slots.filter((x) => x.start > Date.now());
    const s = day.find((x) => x.staffIds.length >= 2);
    const s2 = day.find((x) => x.start !== s?.start);
    if (!s || !s2) continue;
    try {
      const a = createHold({ shopId: sh.id, serviceIds: [colourSvc.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'A', idempotencyKey: `mv-a-${d}` });
      confirmBooking(a.bookingId);
      const c = createHold({ shopId: sh.id, serviceIds: [colourSvc.id], staffId: null, startsAt: s2.start, deviceId: dev, guestName: 'C', idempotencyKey: `mv-c-${d}` });
      confirmBooking(c.bookingId);
      aId = a.bookingId;
      cId = c.bookingId;
      target = s;
    } catch { /* next day */ }
  }
  assert.ok(cId, 'fixture: two colour seats to collide');
  const otherStaff = target!.staffIds.find((id) => id !== getBooking(aId)!.staffId)!;
  setResources(sh.id, { basins: 0, colourStations: 1 });
  assert.throws(
    () => rescheduleBooking(sh.id, cId, target!.start, otherStaff),
    SlotTaken,
    'a move cannot overbook the single colour station',
  );
  setResources(sh.id, { basins: 0, colourStations: 0 });
  rescheduleBooking(sh.id, cId, target!.start, otherStaff); // untracked → the same move is fine
}

// Watches dedupe: the same wish twice is one bell.
{
  const dev = 'dev-watch-dupe';
  const w1 = addAvailabilityWatch(dev, shop.id, svc.id, null, 6);
  const w2 = addAvailabilityWatch(dev, shop.id, svc.id, null, 6);
  assert.equal(w1.id, w2.id, 'no duplicate watch minted');
  assert.equal(myWatches(dev).length, 1);
  const w3 = addAvailabilityWatch(dev, shop.id, svc.id, null, 2); // a different day IS a different wish
  assert.notEqual(w1.id, w3.id);
  removeAvailabilityWatch(dev, w1.id);
  removeAvailabilityWatch(dev, w3.id);
}

// Clearing a service's resource marker survives persistence: null, not a
// JSON-dropped undefined that resurrects the seed.
{
  const sh = allShops()[0];
  const colourSvc = sh.services.find((s) => s.resource === 'colour')!;
  patchService(sh.id, colourSvc.id, { resource: null });
  assert.ok(!effectiveServices(sh.id).find((s) => s.id === colourSvc.id)!.resource, 'cleared in the merged view');
  const roundTripped = JSON.parse(JSON.stringify(Object.fromEntries(serviceOverrideEntries())))[colourSvc.id];
  assert.equal(roundTripped.resource, null, 'the cleared marker survives a JSON round trip');
  patchService(sh.id, colourSvc.id, { resource: 'colour' });
  assert.equal(effectiveServices(sh.id).find((s) => s.id === colourSvc.id)!.resource, 'colour');
}

// A stale device's sync cannot reopen an answered dispute — resolved wins.
{
  const d2 = openDispute(rhythmIds[0], rhythmDev, 'other', 'Musik zu laut.');
  const stale = exportShopConfig(shop.id); // still carries the open copy
  resolveDispute(shop.id, d2.id, { kind: 'declined', note: 'War Konzertabend.' });
  applyShopConfig(shop.id, stale);
  assert.equal(
    myDisputes(rhythmDev).find((x) => x.id === d2.id)!.status,
    'resolved',
    'the stale document does not resurrect the open copy',
  );
}

// Erasure now reaches everything this batch added; the export names it all.
{
  const dev = 'dev-erase2';
  setAccessNeeds(dev, { quiet: true, note: 'bitte leise' });
  let held = '';
  for (let d = 1; d <= 21 && !held; d++) {
    const s = availability(shop.id, [svc.id], addDays(todayIso(), d), dev, null).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      held = createHold({ shopId: shop.id, serviceIds: [svc.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'E', forMinor: true, guardianName: 'Oma Erna', idempotencyKey: `er2-${d}` }).bookingId;
    } catch { /* next day */ }
  }
  assert.ok(held, 'fixture: a minor booking with access needs');
  const w = addAvailabilityWatch(dev, shop.id, svc.id, null, null);
  const offer = savePackageOffer(shop.id, { serviceId: svc.id, count: 5, priceCents: 9900 });
  buyPackage(shop.id, offer.id, dev);
  setMembershipOffer(shop.id, { priceCents: 900, discountPct: 10 });
  joinMembership(dev, shop.id);

  const ex = exportMyData(dev);
  assert.equal((ex.packages as unknown[]).length, 1, 'the export names the prepaid card');
  assert.equal((ex.memberships as unknown[]).length, 1, 'the export names the membership');
  assert.equal((ex.watches as unknown[]).length, 1, 'the export names the watch');
  assert.ok(Array.isArray(ex.disputes), 'the export carries the dispute history');

  eraseMyData(dev);
  const eb = getBooking(held)!;
  assert.equal(eb.minor, undefined, 'the guardian name is gone');
  assert.equal(eb.access, undefined, 'the access flags are gone');
  assert.equal(myWatches(dev).length, 0, 'the watches stop firing');
  assert.equal(myMembership(dev, shop.id), null, 'the membership is gone');
  assert.equal(myPackages(dev).length, 0, 'the cards are gone');
  setMembershipOffer(shop.id, null);
  void w;

  // and the complaint words on the earlier device go too
  eraseMyData(rhythmDev);
  assert.ok(myDisputes(rhythmDev).every((x) => x.text === '—'), 'erasure blanks the complaint words');
}

// ---------------------------------------------------------------------------
// verticals round: new categories, kids filter, 18+ guard, corporate packages
// ---------------------------------------------------------------------------

// The marketplace now carries the new verticals, and the feed can filter them.
{
  const cats = new Set(allShops().map((s) => s.category));
  for (const c of ['spa', 'makeup', 'tattoo', 'physio', 'kids']) {
    assert.ok(cats.has(c as never), `the ${c} vertical is seeded`);
  }
  const spa = feed({ category: 'spa' });
  assert.ok(spa.length >= 1 && spa.every((c) => c.shopId === 'shop-sanfte-stunde'), 'the spa chip finds the spa');
  const kids = feed({ kidsFriendly: true });
  assert.ok(kids.length >= 1 && kids.every((c) => c.kidsFriendly), 'the kids filter keeps only kids-built places');
  assert.ok(kids.some((c) => c.shopId === 'shop-kleine-schere'));
  const eclat = feed({}).find((c) => c.shopId === 'shop-eclat');
  assert.ok(eclat?.premium, 'the concierge tier is flagged on its card');
  // and the new shops actually project bookable days
  const spaShop = allShops().find((s) => s.id === 'shop-sanfte-stunde')!;
  let found = false;
  for (let d = 1; d <= 14 && !found; d++) {
    found = availability(spaShop.id, [spaShop.services[0].id], addDays(todayIso(), d), 'dev-vert', null).slots.length > 0;
  }
  assert.ok(found, 'the spa has bookable slots');
}

// 18+: tattoos and piercings refuse minors outright, guardian or not.
{
  const tat = allShops().find((s) => s.id === 'shop-schwarzwerk')!;
  const needle = tat.services.find((s) => s.adultsOnly)!;
  const jewel = tat.services.find((s) => !s.adultsOnly && !s.requiresPatchTest)!;
  assert.throws(
    () => createHold({ shopId: tat.id, serviceIds: [needle.id], staffId: null, startsAt: Date.now() + 5 * 864e5, deviceId: 'dev-18', guestName: 'Kid', forMinor: true, guardianName: 'Papa Krause', idempotencyKey: 'a18-1' }),
    /minor_adults_only/,
    'a guardian does not make a tattoo legal',
  );
  // a non-needle service at the same studio books fine for a minor
  let held = '';
  for (let d = 1; d <= 21 && !held; d++) {
    const s = availability(tat.id, [jewel.id], addDays(todayIso(), d), 'dev-18', null).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      held = createHold({ shopId: tat.id, serviceIds: [jewel.id], staffId: null, startsAt: s.start, deviceId: 'dev-18', guestName: 'Kid', forMinor: true, guardianName: 'Papa Krause', idempotencyKey: `a18-${d}` }).bookingId;
    } catch { /* next day */ }
  }
  assert.ok(held, 'the jewellery check books for a minor with a guardian');
}

// Corporate packages: one order, N ordinary gift cards, a volume discount.
{
  assert.equal(corporateDiscountPct(4), 0);
  assert.equal(corporateDiscountPct(5), 5);
  assert.equal(corporateDiscountPct(10), 10);
  assert.equal(corporateDiscountPct(20), 15);
  const dev = 'dev-corp';
  assert.throws(() => buyCorporateBatch(shop.id, dev, 'Tiny GmbH', 2, 5000), /bad_count/);
  assert.throws(() => buyCorporateBatch(shop.id, dev, '   ', 10, 5000), /company_required/);
  const giftBefore = giftCardsForShop(shop.id);
  const batch = buyCorporateBatch(shop.id, dev, 'Späti Ventures GmbH', 10, 5000);
  // no double books: the batch lives in the B2B section, not the gift KPIs
  const giftAfter = giftCardsForShop(shop.id);
  assert.equal(giftAfter.soldCents, giftBefore.soldCents, 'the gift-card KPIs do not re-count the batch at face value');
  assert.ok(giftAfter.cards.every((c) => !batch.codes.includes(c.code)), 'batch codes stay out of the gift-card list');
  assert.equal(batch.codes.length, 10);
  assert.equal(batch.discountPct, 10);
  assert.equal(batch.paidCents, 45000, 'ten €50 cards cost €450 with the volume discount');
  // every code is an ordinary, fully-funded gift card
  for (const code of batch.codes) {
    const v = validateVoucher(code, 5000);
    assert.ok(v.ok && v.discountCents === 5000, 'each code redeems at full face value');
    assert.equal(giftCard(code)!.fromName, 'Späti Ventures GmbH');
  }
  assert.equal(myCorporateBatches(dev)[0].id, batch.id);
  const shopView = corporateBatchesForShop(shop.id);
  assert.equal(shopView.paidCents, 45000);
  assert.equal(shopView.outstandingCents, 50000, 'liability is the face value, not the discounted price');
  // privacy: the export names the order, erasure keeps the numbers but not the name
  const ex = exportMyData(dev);
  assert.equal((ex.corporateBatches as unknown[]).length, 1);
  eraseMyData(dev);
  assert.equal(myCorporateBatches(dev)[0].company, '—', 'erasure blanks the company name');
  assert.equal(giftCard(batch.codes[0])!.fromName, undefined, 'the name is gone from every minted card too');
  assert.equal(giftCard(batch.codes[0])!.balanceCents, 5000, 'the value stays for the recipient');
  assert.equal(corporateBatchesForShop(shop.id).paidCents, 45000, 'the books still add up');
}

// Feed honesty: a €0 planning call is not a price, and "at home" is a
// property, not a genre.
{
  const eclat = feed({}).find((c) => c.shopId === 'shop-eclat');
  assert.ok(eclat && eclat.priceFromCents > 0, 'the concierge suite is not "from €0"');
  const priced = feed({ sortBy: 'price' });
  assert.notEqual(priced[0]?.shopId, 'shop-eclat', 'the most expensive shop does not lead the price sort');
  const atHome = feed({ category: 'mobile' });
  assert.ok(atHome.some((c) => c.shopId === 'shop-mobile-physio'), 'the At-home chip finds the mobile physio');
  assert.ok(atHome.every((c) => c.isMobile), 'and only shops that actually come to you');
}

// 18+ bookings always carry the ID flag — the studio checks at the door.
{
  const tat = allShops().find((s) => s.id === 'shop-schwarzwerk')!;
  const pierce = tat.services.find((s) => s.adultsOnly && s.durationMin <= 30)!;
  const dev = 'dev-idcheck';
  let held = '';
  for (let d = 1; d <= 21 && !held; d++) {
    const s = availability(tat.id, [pierce.id], addDays(todayIso(), d), dev, null).slots.find((x) => x.start > Date.now());
    if (!s) continue;
    try {
      held = createHold({ shopId: tat.id, serviceIds: [pierce.id], staffId: null, startsAt: s.start, deviceId: dev, guestName: 'A', forPersonId: 'p-cousin', idempotencyKey: `idc-${d}` }).bookingId;
    } catch { /* next day */ }
  }
  assert.ok(held, 'fixture: a piercing booked for someone else');
  assert.equal(getBooking(held)!.needsIdCheck, true, 'booking for a third person still flags the ID check');
}

console.log('OK — every batch checks out: payments, loyalty, floor, records, scheduling, money products, care & safety, discovery & ops, and verticals');
