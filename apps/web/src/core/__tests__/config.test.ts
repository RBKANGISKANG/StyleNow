/**
 * The shop configuration document — the thing that makes the back office work
 * on more than one device.
 *
 * Two properties matter and neither is obvious from reading the code:
 *  1. a document carries only its own shop's slice, so two salons syncing
 *     against the same project never overwrite each other;
 *  2. applying one replaces that shop's slice outright, so an edit made on a
 *     device that has since fallen behind does not resurrect itself.
 */
import assert from 'node:assert/strict';
import {
  allShops, addStaff, addLocation, addAbsence, addClosure, setCustomerNote,
  effectiveStaff, shopLocations, shopClosures, absencesFor,
  exportShopConfig, applyShopConfig, setLocalPersistence,
} from '../store';

setLocalPersistence(false);
const [a, b] = allShops();
console.log('shops:', a.id, b.id);

// --- configure shop A -------------------------------------------------------
const st = addStaff(a.id, { name: 'Doc Tester', role: { en: 'Colourist', de: 'Coloristin' }, tier: 'stylist' } as never);
addLocation(a.id, { label: 'Second floor', street: 'Torstr. 1', zip: '10119', city: 'Berlin', district: 'Mitte' });
addAbsence(st.id, { from: '2026-09-01', to: '2026-09-03', kind: 'vacation', note: 'Doc holiday' });
addClosure(a.id, { from: '2026-12-24', to: '2026-12-26', reason: 'Weihnachten' });
setCustomerNote(a.id, 'p:49170', 'Colour 7.1');

// --- and shop B, so we can prove slices do not bleed -------------------------
const stB = addStaff(b.id, { name: 'Other Shop Person', role: { en: 'Stylist', de: 'Stylist' }, tier: 'stylist' } as never);
setCustomerNote(b.id, 'p:49999', 'B note');

const doc = exportShopConfig(a.id);
console.log('exported:', JSON.stringify({
  staff: doc.staff?.map((s) => s.name),
  locations: doc.locations?.map((l) => l.label),
  absences: doc.absences?.length,
  closures: doc.closures?.map((c) => c.reason),
  notes: doc.customerNotes,
}));

assert.deepEqual(doc.staff?.map((s) => s.name), ['Doc Tester'], 'shop A staff');
assert.equal(doc.customerNotes?.length, 1, 'only shop A notes');
assert.equal(doc.customerNotes?.[0][0], `${a.id}:p:49170`);
assert.ok(!doc.staff?.some((s) => s.name === 'Other Shop Person'), 'no bleed from shop B');

// --- simulate the second device: local edits differ, then the doc arrives ----
const st2 = addStaff(a.id, { name: 'Stale Local', role: { en: 'X', de: 'X' }, tier: 'stylist' } as never);
assert.ok(effectiveStaff(a.id).some((s) => s.name === 'Stale Local'));

applyShopConfig(a.id, doc);

const names = effectiveStaff(a.id).map((s) => s.name);
assert.ok(names.includes('Doc Tester'), 'synced stylist present');
assert.ok(!names.includes('Stale Local'), 'the document is the source of truth for this shop');
assert.deepEqual(shopLocations(a.id).map((l) => l.label).includes('Second floor'), true, 'locations restored');
assert.deepEqual(shopClosures(a.id).map((c) => c.reason), ['Weihnachten'], 'closures restored');
assert.equal(absencesFor(st.id).length, 1, 'absences restored');
assert.equal(absencesFor(st.id)[0].note, 'Doc holiday');

// shop B untouched by applying shop A's document
assert.ok(effectiveStaff(b.id).some((s) => s.id === stB.id), 'shop B staff survived');

console.log('names in A after apply:', names.join(', '));
console.log('shop B staff still there:', effectiveStaff(b.id).map((s) => s.name).join(', '));
console.log('\nOK — config document round-trips and stays inside its own shop');
