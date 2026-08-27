/**
 * Opening hours on a shop's own page.
 *
 * The point of deriving them from the roster rather than storing them is that
 * they cannot drift — so the things worth pinning down are the derivations:
 * two stylists on overlapping shifts read as one span, a day nobody works reads
 * as closed, and a holiday entered in the back office both takes the day off
 * the page and says why.
 */
import assert from 'node:assert/strict';
import {
  allShops, addStaff, patchStaff, addClosure, effectiveStaff, archiveStaff,
  openingHours, shopStatus, setLocalPersistence,
} from '../store';
import { dayStart, isoDow, todayIso, addDays } from '../time';

setLocalPersistence(false);
const [shop] = allShops();

const mk = (name: string, shifts: Record<number, Array<{ startMin: number; endMin: number }>>) => {
  const st = addStaff(shop.id, { name, role: { en: 'Stylist', de: 'Stylist' }, tier: 'stylist' } as never);
  patchStaff(shop.id, st.id, { shifts });
  return st;
};

// Two people whose Monday shifts overlap, and a Saturday only one of them works.
const seeded = effectiveStaff(shop.id).map((s) => s.id);
mk('Early', { 1: [{ startMin: 9 * 60, endMin: 14 * 60 }] });
mk('Late', { 1: [{ startMin: 13 * 60, endMin: 19 * 60 }], 6: [{ startMin: 10 * 60, endMin: 16 * 60 }] });
// Retire the seeded team only once the fixture is in place — a shop is never
// allowed to have nobody on it.
for (const id of seeded) archiveStaff(shop.id, id);
assert.deepEqual(effectiveStaff(shop.id).map((s) => s.name), ['Early', 'Late'], 'fixture roster only');

const hours = openingHours(shop.id);
const on = (dow: number) => hours.find((h) => h.dow === dow)!.windows;

console.log('week:', hours.map((h) => `${h.dow}:${h.windows.map((w) => `${w.startMin}-${w.endMin}`).join(',') || 'shut'}`).join(' '));

assert.equal(hours.length, 7, 'a full week, Monday first');
assert.equal(hours[0].dow, 1, 'Monday first');
assert.equal(hours[6].dow, 7, 'Sunday last');

// 09:00–14:00 and 13:00–19:00 are one span, not two — a customer reads opening
// hours, not a rota.
assert.deepEqual(on(1), [{ startMin: 540, endMin: 1140 }], 'overlapping shifts merge');
assert.deepEqual(on(6), [{ startMin: 600, endMin: 960 }], 'Saturday from the one who works it');
assert.deepEqual(on(2), [], 'nobody rostered Tuesday → shut');
assert.deepEqual(on(7), [], 'nobody rostered Sunday → shut');

// A gap between two shifts must survive as a gap: a lunchtime close is real.
mk('Split', { 3: [{ startMin: 9 * 60, endMin: 12 * 60 }, { startMin: 15 * 60, endMin: 18 * 60 }] });
assert.deepEqual(
  openingHours(shop.id).find((h) => h.dow === 3)!.windows,
  [{ startMin: 540, endMin: 720 }, { startMin: 900, endMin: 1080 }],
  'a real gap is not merged away',
);

// --- open right now? -------------------------------------------------------
// Anchor on a weekday we control rather than on whatever today happens to be.
const monday = (() => {
  let iso = todayIso();
  while (isoDow(dayStart(iso)) !== 1) iso = addDays(iso, 1);
  return iso;
})();

const at = (iso: string, min: number) => dayStart(iso) + min * 60_000;

const midMorning = shopStatus(shop.id, at(monday, 10 * 60));
assert.equal(midMorning.open, true, 'Monday 10:00 is open');
assert.equal(midMorning.closesAtMin, 1140, 'and says when it shuts');

const evening = shopStatus(shop.id, at(monday, 20 * 60));
assert.equal(evening.open, false, 'Monday 20:00 is shut');
assert.equal(evening.nextOpenIso, addDays(monday, 2), 'Tuesday is empty, so Wednesday is next');
assert.equal(evening.nextOpenMin, 540);

const beforeOpening = shopStatus(shop.id, at(monday, 7 * 60));
assert.equal(beforeOpening.open, false, '07:00 is shut');
assert.equal(beforeOpening.nextOpenIso, monday, 'but it opens later the same day');
assert.equal(beforeOpening.nextOpenMin, 540);

// --- a holiday closes the doors and explains itself ------------------------
addClosure(shop.id, { from: monday, to: monday, reason: 'Betriebsferien' });
const shut = shopStatus(shop.id, at(monday, 10 * 60));
assert.equal(shut.open, false, 'a closure beats the roster');
assert.equal(shut.closedReason, 'Betriebsferien', 'and says why — "closed" alone reads as "closed down"');
assert.equal(shut.nextOpenIso, addDays(monday, 2), 'skips the closed day entirely');

console.log('Monday 10:00 →', midMorning.open ? `open until ${midMorning.closesAtMin}` : 'shut');
console.log('Monday 20:00 →', `shut, next ${evening.nextOpenIso} ${evening.nextOpenMin}`);
console.log('Monday 10:00 on a Betriebsferien →', `shut — ${shut.closedReason}, back ${shut.nextOpenIso}`);
console.log('\nOK — opening hours derive from the roster and closures override them');
