/**
 * The two self-service doors added for the people who are not the shop:
 * an employee asking for time off, and a customer moving their own booking.
 *
 * Both are trust boundaries, so what is worth pinning down is exactly what
 * each door must NOT allow: a pending request must not empty the calendar,
 * and a customer must not move somebody else's booking or move their own once
 * the free-cancellation window has closed — that would be fee-dodging.
 */
import assert from 'node:assert/strict';
import {
  allShops, availability, requestAbsence, approveAbsence, isAbsent,
  createShopBooking, rescheduleBooking, setLocalPersistence, effectiveStaff,
} from '../store';
import { todayIso, addDays, isoDow } from '../time';

setLocalPersistence(false);
const [shop] = allShops();
const staff = effectiveStaff(shop.id)[0];
const svc = shop.services[0];

// A weekday far enough out that slots exist and the free window is open.
let iso = addDays(todayIso(), 7);
while (![1, 2, 3, 4, 5].includes(isoDow(iso))) iso = addDays(iso, 1);

// --- time off: pending is a question, approved is a fact --------------------

const before = availability(shop.id, [svc.id], iso, 'dev-test', staff.id).slots.length;
assert.ok(before > 0, `fixture needs a bookable day, got 0 slots on ${iso}`);

const req = requestAbsence(staff.id, { from: iso, to: iso, kind: 'vacation' });
assert.equal(isAbsent(staff.id, iso), false, 'a pending request must not read as absent');
assert.equal(
  availability(shop.id, [svc.id], iso, 'dev-test', staff.id).slots.length,
  before,
  'a pending request must not remove a single slot',
);

approveAbsence(staff.id, req.id);
assert.equal(isAbsent(staff.id, iso), true, 'an approved request is a real absence');
assert.equal(
  availability(shop.id, [svc.id], iso, 'dev-test', staff.id).slots.length,
  0,
  'approval takes the day off sale',
);
console.log(`time off: ${before} slots → pending ${before} → approved 0`);

// --- moving your own booking ------------------------------------------------

// Book on a different open day so the approved holiday above stays clean.
let iso2 = addDays(iso, 1);
while (![1, 2, 3, 4, 5].includes(isoDow(iso2))) iso2 = addDays(iso2, 1);
const slots = availability(shop.id, [svc.id], iso2, 'dev-cust', staff.id).slots;
assert.ok(slots.length >= 2, 'fixture needs at least two free slots');

const booking = createShopBooking(shop.id, [svc.id], staff.id, slots[0].start, 'Mover');
// Shop bookings carry a shop device id; pretend the customer owns it.
booking.deviceId = 'dev-cust';

// Somebody else cannot move it.
assert.throws(
  () => rescheduleBooking(shop.id, booking.id, slots[1].start, null, { byDevice: 'dev-intruder' }),
  /not_yours/,
  'moving another device’s booking must be refused',
);

// The owner can, while the window is open (7+ days out beats any policy).
rescheduleBooking(shop.id, booking.id, slots[1].start, null, { byDevice: 'dev-cust' });
assert.equal(booking.startsAt, slots[1].start, 'the move landed');
assert.ok(booking.movedAt, 'a customer move is stamped, so the shop gets its notice');
assert.equal(booking.movedFromStartsAt, slots[0].start, 'and remembers where it came from');

// Once the free window is over, the door closes.
booking.startsAt = Date.now() + 30 * 60_000; // half an hour from now
assert.throws(
  () => rescheduleBooking(shop.id, booking.id, booking.startsAt + 3_600_000, null, { byDevice: 'dev-cust' }),
  /too_late/,
  'inside the fee window, moving online must be refused',
);
console.log('moves: stranger refused, owner moved and was stamped, late move refused');

console.log('\nOK — pending requests block nothing, approvals block the day, and moving stays inside the policy');
