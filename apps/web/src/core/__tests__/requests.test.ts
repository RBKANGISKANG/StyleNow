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
  bookSeries, bookingConflicts, archiveStaff, setBookingStatus, noticesForDevice,
} from '../store';
import { todayIso, addDays, isoDow, dayStart } from '../time';

setLocalPersistence(false);
const [shop] = allShops();
const staff = effectiveStaff(shop.id)[0];
const svc = shop.services[0];

// A weekday far enough out that slots exist and the free window is open.
let iso = addDays(todayIso(), 7);
while (![1, 2, 3, 4, 5].includes(isoDow(dayStart(iso)))) iso = addDays(iso, 1);

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
while (![1, 2, 3, 4, 5].includes(isoDow(dayStart(iso2)))) iso2 = addDays(iso2, 1);
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

// --- standing appointments ----------------------------------------------------

// The demo synthesises busy blocks for every stylist-day, so pick a parent
// time that is verifiably free at +4 and +8 weeks too (times in the offered
// slot list are guaranteed free — it is a thinned subset of the free grid).
const week4 = availability(shop.id, [svc.id], addDays(iso2, 28), 'dev-cust', staff.id).slots.map((s) => s.start);
const seed = slots.find((s) => s.start !== booking.startsAt && week4.includes(s.start + 28 * 864e5));
assert.ok(seed, 'fixture: no time free four weeks later — adjust the search');

// Put the series parent on that time.
booking.startsAt = seed!.start;

// A stranger cannot start a series on someone else's booking.
assert.throws(() => bookSeries('dev-intruder', booking.id, 4, 1), /not_yours/);

const series = bookSeries('dev-cust', booking.id, 4, 1);
assert.equal(series.booked.length, 1, 'the verified-free occurrence books');
for (const child of series.booked) {
  assert.equal(child.seriesId, booking.id, 'members carry the series id');
  assert.equal(child.status, 'confirmed');
  assert.equal(child.paidCents, 0, 'future visits are settled at the salon');
}
// Booking the same series again must not double it.
const rerun = bookSeries('dev-cust', booking.id, 4, 1);
assert.equal(rerun.booked.length, 0, 'a rerun recognises its own members and books nothing');
assert.equal(rerun.skippedDates.length, 1);
console.log(`series: ${series.booked.length} booked, rerun booked ${rerun.booked.length} (skipped ${rerun.skippedDates.length})`);


// --- conflict guard: personnel decisions must not strand booked customers -----

// The customer's booking and the series child both sit on this stylist's book.
const conflicts = bookingConflicts(shop.id, { staffId: staff.id });
assert.ok(
  conflicts.some((c) => c.bookingId === booking.id),
  'an upcoming booking shows up as a conflict for its stylist',
);
const child = series.booked[0];
assert.ok(
  conflicts.some((c) => c.bookingId === child.id),
  'series members conflict too',
);

// Archiving somebody with booked customers is refused, not silently done.
assert.throws(() => archiveStaff(shop.id, staff.id), /has_bookings/);

// The front desk hands the visit to a colleague on a day they are free.
const colleague = effectiveStaff(shop.id).find((s) => s.id !== staff.id)!;
assert.ok(colleague, 'fixture needs a second stylist');
let iso3 = addDays(iso2, 2);
let colleagueSlots: Array<{ start: number }> = [];
for (let i = 0; i < 14 && colleagueSlots.length === 0; i++) {
  if ([1, 2, 3, 4, 5].includes(isoDow(dayStart(iso3)))) {
    colleagueSlots = availability(shop.id, [svc.id], iso3, 'dev-cust', colleague.id).slots;
  }
  if (colleagueSlots.length === 0) iso3 = addDays(iso3, 1);
}
assert.ok(colleagueSlots.length > 0, 'fixture: colleague has no free day in two weeks');

rescheduleBooking(shop.id, booking.id, colleagueSlots[0].start, colleague.id);
assert.equal(booking.staffId, colleague.id, 'the visit changed hands');
assert.ok(booking.reassignedAt, 'a staff change by the shop is stamped');
assert.ok(booking.shopMovedAt, 'a time change by the shop is stamped');

const custNotices = noticesForDevice('dev-cust');
assert.ok(custNotices.some((n) => n.kind === 'staff_changed' && n.who === colleague.name),
  'the customer is told who their new stylist is');
assert.ok(custNotices.some((n) => n.kind === 'appt_moved'),
  'the customer is told the shop moved their time');

// The remaining conflict is cancelled — shop cancels always refund in full.
setBookingStatus(shop.id, child.id, 'cancelled_by_shop');
assert.equal(child.status, 'cancelled_by_shop');
assert.equal(child.cancellation!.feeCents, 0, 'the shop broke the promise, the shop eats the fee');

const after = bookingConflicts(shop.id, { staffId: staff.id });
assert.ok(!after.some((c) => c.bookingId === booking.id || c.bookingId === child.id),
  'resolved bookings leave the conflict list');
console.log(`conflicts: ${conflicts.length} found, archive refused, one reassigned (+2 customer notices), one refunded`);

console.log('\nOK — pending requests block nothing, approvals block the day, and moving stays inside the policy');
