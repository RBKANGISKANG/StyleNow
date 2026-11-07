#!/usr/bin/env node
/**
 * End-to-end test against REAL Stripe test mode. Run it once before launch,
 * and after any change to payments.
 *
 *   1. Start the server with Stripe test keys:
 *        STRIPE_SECRET_KEY=sk_test_…  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…  (build with the pk set)
 *        STYLENOW_ADMIN_KEY=…  DATABASE_URL=…  npm run start
 *   2. STRIPE_SECRET_KEY=sk_test_… npm run stripe:test -- --url http://localhost:3000
 *
 * Refuses to run with a live key. What it checks:
 *   A. A salon signs up with an IBAN → a hidden Stripe (Custom) payout account exists
 *   B. The salon's owner details + Stripe's test ID document → payouts become enabled
 *   C. A guest books at that salon and pays with test card 4242 in the real checkout
 *   D. The booking is confirmed and the charge sits on the PLATFORM balance (no transfer yet)
 *   E. The salon marks the visit completed → a transfer of the salon's share is sent
 *   F. A second paid booking is cancelled by the salon → the guest is refunded in Stripe
 */
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('url', process.env.STYLENOW_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SK = process.env.STRIPE_SECRET_KEY ?? '';
if (!SK.startsWith('sk_test_')) {
  console.error('Set STRIPE_SECRET_KEY to a TEST key (sk_test_…). This script never runs against live mode.');
  process.exit(1);
}

const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`); console.log(results.at(-1)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { authorization: `Bearer ${SK}` } });
  return res.json();
}

function client(device) {
  let cookie = '';
  return async (path, method = 'GET', body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-sn-device': device, 'idempotency-key': `idem-${Math.random()}`, ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}

// ---- A. salon sign-up with IBAN -------------------------------------------------
const stamp = Date.now();
const ownerEmail = `stripe-test-${stamp}@example.com`;
const ownerDev = `dev-stripe-owner-${stamp}`;
const owner = client(ownerDev);
await owner('/api/auth/register', 'POST', { email: ownerEmail, password: 'Stripe12345', profile: { name: 'Test Owner' }, deviceId: ownerDev });
const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: true, from: '08:00', to: '20:00' }]));
const apply = await owner('/api/partner/apply', 'POST', {
  deviceId: ownerDev,
  payout: { iban: 'DE89370400440532013000' },
  data: {
    business: { legalName: `Stripe Test GmbH ${stamp}`, displayName: `Stripe Test Salon ${stamp}`, categories: ['hair'], email: ownerEmail, phone: '+49 40 1234567', vatId: 'DE123456789' },
    locations: [{ mobile: false, street: 'address_full_match', zip: '22041', city: 'Hamburg' }],
    offer: { services: [{ name: 'Test cut', priceCents: 5000, durationMin: 30 }], staffCount: 1, openingHours: hours, languages: ['de'] },
    payoutAndPolicy: { owner: 'Test Owner', freeUntilHours: 24, lateFeePercent: 50, noShowFeePercent: 100, depositPercent: 0 },
    consents: { partnerTerms: true, accuracy: true },
    ownerKey: ownerEmail,
  },
});
const shopId = apply.data.shop?.id;
check('A. salon live after sign-up', apply.status === 201 && !!shopId, JSON.stringify(apply.data).slice(0, 120));
check('A. hidden Stripe payout account created at sign-up', apply.data.payouts === 'created', String(apply.data.payouts));

// ---- B. owner details → payouts enabled ------------------------------------------
await owner('/api/stripe/connect', 'POST', {
  shopId,
  person: { firstName: 'Test', lastName: 'Owner', dob: '1901-01-01', email: ownerEmail, phone: '+4940123456', street: 'address_full_match', zip: '22041', city: 'Hamburg' },
  company: { legalName: `Stripe Test GmbH ${stamp}`, vatId: 'DE123456789', phone: '+4940123456', street: 'address_full_match', zip: '22041', city: 'Hamburg' },
  documentFileId: 'file_identity_document_success',
});
let status;
for (let i = 0; i < 20; i++) {
  status = (await owner(`/api/stripe/connect?shopId=${shopId}`)).data;
  if (status.payoutsEnabled) break;
  await sleep(3000);
}
check('B. payouts enabled for the salon', !!status?.payoutsEnabled, `still needs: ${(status?.needs ?? []).join(', ') || '–'}`);

// ---- C. a guest pays with 4242 in the real embedded checkout ------------------------
async function payInBrowser() {
  // Playwright drives the real checkout page (npm i -D playwright && npx playwright install chromium).
  const { chromium } = await import('playwright').catch(() => createRequire(import.meta.url)('playwright'));
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await b.newPage();
  await p.goto(`${BASE}/shops/${apply.data.shop?.slug}/book`, { waitUntil: 'networkidle' });
  await p.locator('button', { hasText: 'Test cut' }).first().click().catch(() => {});
  await p.locator('.bf-sticky').click().catch(() => {});
  await p.waitForTimeout(800);
  const days = p.locator('button:visible').filter({ hasText: /^\s*(mon|tue|wed|thu|fri|sat|sun)\s*\d+\s*$/i });
  const times = p.locator('button:visible').filter({ hasText: /^\s*\d{1,2}:\d{2}/ });
  for (let d = 1; d < 10; d++) { await days.nth(d).click(); await p.waitForTimeout(700); if (await times.count()) break; }
  await times.first().click();
  await p.waitForTimeout(800);
  for (const inp of await p.locator('input:visible').all()) {
    const ty = await inp.getAttribute('type');
    if (['checkbox', 'radio', 'date'].includes(ty)) continue;
    if (!(await inp.inputValue())) await inp.fill(ty === 'email' ? `guest-${stamp}@example.com` : 'Test Guest').catch(() => {});
  }
  await p.locator('.bf-actions .btn-primary').click();
  const frame = p.frameLocator('iframe[name*="embedded-checkout"], iframe[src*="checkout.stripe.com"]').first();
  await frame.locator('#email').fill(`guest-${stamp}@example.com`, { timeout: 30000 }).catch(() => {});
  await frame.locator('#cardNumber').fill('4242424242424242', { timeout: 30000 });
  await frame.locator('#cardExpiry').fill('12 / 34');
  await frame.locator('#cardCvc').fill('123');
  await frame.locator('#billingName').fill('Test Guest').catch(() => {});
  await frame.locator('#billingPostalCode').fill('22041').catch(() => {});
  await frame.locator('button[type=submit], .SubmitButton').first().click();
  await p.waitForURL(/\/bookings/, { timeout: 60000 });
  const device = await p.evaluate(() => localStorage.getItem('sn-device'));
  await b.close();
  return device;
}

let guestDev = null;
try {
  guestDev = await payInBrowser();
  check('C. paid with test card 4242 in the embedded checkout', !!guestDev);
} catch (e) {
  check('C. paid with test card 4242 in the embedded checkout', false, e.message.split('\n')[0]);
}

// ---- D/E. confirmed, held on the platform, then transferred on completion ---------------
if (guestDev) {
  const guest = client(guestDev);
  const mine = (await guest(`/api/me/bookings?deviceId=${guestDev}`)).data.bookings ?? [];
  const bk = mine.find((b) => b.shop?.id === shopId && b.status === 'confirmed');
  check('D. booking confirmed by Stripe', !!bk);
  const charge = ((await stripeGet('payment_intents?limit=20')).data ?? []).find((x) => (x.metadata?.bookingIds ?? '').split(',').includes(bk?.id));
  check('D. money taken by the platform, not yet sent to the salon', charge?.status === 'succeeded' && !charge?.transfer_data, charge?.status);

  const done = await owner(`/api/shop/${shopId}/bookings/${bk?.id}/status`, 'POST', { status: 'completed' });
  check('E. salon marks the visit completed', done.status === 200, String(done.status));
  await sleep(3000);
  const acct = (await stripeGet(`accounts?limit=20`)).data?.find((a) => a.metadata?.shopId === shopId);
  const transfers = acct ? (await stripeGet(`transfers?destination=${acct.id}&limit=5`)).data ?? [] : [];
  const t = transfers.find((x) => x.metadata?.bookingId === bk?.id);
  check('E. salon share transferred after completion', !!t, t ? `${(t.amount / 100).toFixed(2)} € (platform kept ${t.metadata.platformCents / 100} €)` : 'no transfer');
}

// ---- F. salon cancels a paid booking → refund ------------------------------------------
try {
  const dev2 = await payInBrowser();
  const g2 = client(dev2);
  const bk2 = ((await g2(`/api/me/bookings?deviceId=${dev2}`)).data.bookings ?? []).find((b) => b.shop?.id === shopId && b.status === 'confirmed');
  const c = await owner(`/api/shop/${shopId}/bookings/${bk2?.id}/status`, 'POST', { status: 'cancelled_by_shop' });
  check('F. salon cancels a paid booking', c.status === 200);
  check('F. guest refunded through Stripe', (c.data.stripeRefundedCents ?? 0) > 0, `${(c.data.stripeRefundedCents ?? 0) / 100} €`);
} catch (e) {
  check('F. refund on cancellation', false, e.message.split('\n')[0]);
}

const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
