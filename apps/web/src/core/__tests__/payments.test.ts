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
  sendMessage, addClosure, messageThread, dayLoadForecast, shopTrust, quietWindows,
  setShopAnnouncement, shopAnnouncement,
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

console.log('OK — Luhn, brands, expiry, IBAN mod-97, masked labels, per-method revenue, Tagesabschluss, gift cards, the ledger CSV, referrals, memos, auto-replies, forecasts and announcements all check out');
