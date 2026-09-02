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
import { allShops, availability, createHold, confirmBooking, revenueReport, setLocalPersistence, effectiveStaff } from '../store';
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

console.log('OK — Luhn, brands, expiry, IBAN mod-97, masked labels, and per-method revenue all check out');
