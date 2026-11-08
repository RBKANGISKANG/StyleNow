/**
 * Salon payouts with Stripe Connect *Custom* accounts: the salon never sees
 * Stripe. StyleNow creates the account from what the salon typed into our
 * own sign-up form, sends the IBAN straight to Stripe (it is never stored
 * here), and asks for anything else Stripe still needs (owner's birth date,
 * ID photo, …) in our own dashboard form.
 *
 * The salon accepts Stripe's Connected Account Agreement through our partner
 * terms checkbox — that acceptance (date + IP) is recorded on the account.
 */
import type Stripe from 'stripe';
import { payoutAccount, shopById, shopCountry } from '@/core/store';
import { stripe, syncPayoutAccount, releaseWaitingPayouts } from './stripe-server';

export interface SignupDetails {
  legalName?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  website?: string;
  vatId?: string;
  smallBusiness?: boolean;
  street?: string;
  zip?: string;
  city?: string;
  /** ISO country of the salon (default DE) */
  country?: string;
  accountHolder?: string;
  iban?: string;
}

const clean = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const ibanOk = (iban: string) => /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban.replace(/\s/g, '').toUpperCase());

function address(d: SignupDetails): Stripe.AddressParam | undefined {
  if (!d.street && !d.zip && !d.city) return undefined;
  return { line1: clean(d.street) || undefined, postal_code: clean(d.zip, 12) || undefined, city: clean(d.city, 60) || undefined, country: (d.country || 'DE').toUpperCase() };
}

/** Pull the details out of a partner application's data blob. */
export function detailsFromApplication(data: Record<string, unknown>): SignupDetails {
  const biz = (data.business ?? {}) as Record<string, unknown>;
  const loc = (Array.isArray(data.locations) ? data.locations[0] : {}) as Record<string, unknown>;
  const pay = (data.payoutAndPolicy ?? {}) as Record<string, unknown>;
  return {
    legalName: clean(biz.legalName),
    displayName: clean(biz.displayName),
    email: clean(biz.email),
    phone: clean(biz.phone, 30),
    website: clean(biz.website),
    vatId: clean(biz.vatId, 20),
    smallBusiness: Boolean(biz.smallBusiness),
    country: /^[A-Za-z]{2}$/.test(String(biz.country ?? '')) ? String(biz.country).toUpperCase() : 'DE',
    street: clean(loc?.street),
    zip: clean(loc?.zip, 12),
    city: clean(loc?.city, 60),
    accountHolder: clean(pay.owner),
  };
}

/** Create (once) the salon's hidden Stripe account. Idempotent per shop. */
export async function createCustomAccount(shopId: string, d: SignupDetails, ip: string): Promise<void> {
  if (payoutAccount(shopId)) return;
  const shop = shopById(shopId);
  if (!shop) throw new Error('shop_not_found');
  const iban = (d.iban ?? '').replace(/\s/g, '').toUpperCase();
  const individual = Boolean(d.smallBusiness);
  const acct = await stripe().accounts.create(
    {
      type: 'custom',
      country: (d.country || 'DE').toUpperCase(),
      email: d.email || undefined,
      business_type: individual ? 'individual' : 'company',
      business_profile: { name: d.displayName || shop.name, mcc: '7230', url: d.website || undefined, product_description: 'Hair & beauty salon services booked through StyleNow' },
      ...(individual
        ? { individual: { email: d.email || undefined, phone: d.phone || undefined, address: address(d) } }
        : { company: { name: d.legalName || shop.name, phone: d.phone || undefined, address: address(d), ...(d.vatId ? { vat_id: d.vatId } : {}) } }),
      capabilities: { transfers: { requested: true } },
      ...(ibanOk(iban)
        ? { external_account: { object: 'bank_account', country: iban.slice(0, 2), currency: 'eur', account_holder_name: d.accountHolder || undefined, account_number: iban } }
        : {}),
      tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: ip || '0.0.0.0', service_agreement: 'full' },
      settings: { payouts: { schedule: { interval: 'weekly', weekly_anchor: 'monday' } } },
      metadata: { shopId },
    } as Stripe.AccountCreateParams,
    { idempotencyKey: `custom-${shopId}` },
  );
  syncPayoutAccount(shopId, acct);
}

/** What Stripe still needs, grouped into the form sections our dashboard can show. */
export type DueGroup = 'bank' | 'person' | 'company' | 'document' | 'other';

export async function accountNeeds(shopId: string): Promise<{ groups: DueGroup[]; raw: string[]; deadline: number | null; disabledReason: string | null }> {
  const a = payoutAccount(shopId);
  if (!a) return { groups: ['company', 'bank'], raw: [], deadline: null, disabledReason: null };
  const acct = await stripe().accounts.retrieve(a.accountId);
  if (syncPayoutAccount(shopId, acct).payoutsEnabled) await releaseWaitingPayouts(shopId);
  const raw = [...new Set([...(acct.requirements?.currently_due ?? []), ...(acct.requirements?.past_due ?? [])])];
  const groups = new Set<DueGroup>();
  for (const r of raw) {
    if (r.startsWith('external_account')) groups.add('bank');
    else if (r.includes('verification.document') || r.includes('verification.additional_document')) groups.add('document');
    else if (r.startsWith('company.')) groups.add('company');
    else if (r.startsWith('representative') || r.startsWith('individual') || r.startsWith('person_') || r.startsWith('owners') || r.startsWith('directors') || r.startsWith('executives')) groups.add('person');
    else if (r.startsWith('business_profile')) groups.add('company');
    else groups.add('other');
  }
  return {
    groups: [...groups],
    raw,
    deadline: acct.requirements?.current_deadline ? acct.requirements.current_deadline * 1000 : null,
    disabledReason: acct.requirements?.disabled_reason ?? null,
  };
}

export interface PersonDetails {
  firstName?: string;
  lastName?: string;
  dob?: string; // YYYY-MM-DD
  email?: string;
  phone?: string;
  street?: string;
  zip?: string;
  city?: string;
  title?: string;
}

/** Fill in what the dashboard form collected. Only fields actually sent are touched. */
export async function updateAccount(
  shopId: string,
  input: { company?: SignupDetails; person?: PersonDetails; iban?: string; accountHolder?: string; documentFileId?: string },
): Promise<void> {
  const a = payoutAccount(shopId);
  if (!a) throw new Error('not_connected');
  // Addresses are in the salon's own country unless the form says otherwise.
  const home = shopCountry(shopId);
  if (input.company) input.company = { country: home, ...input.company };
  if (input.person) input.person = { ...input.person };
  const s = stripe();
  const acct = await s.accounts.retrieve(a.accountId);
  const individual = acct.business_type === 'individual';

  if (input.iban) {
    const iban = input.iban.replace(/\s/g, '').toUpperCase();
    if (!ibanOk(iban)) throw new Error('bad_iban');
    await s.accounts.createExternalAccount(a.accountId, {
      external_account: { object: 'bank_account', country: iban.slice(0, 2), currency: 'eur', account_holder_name: input.accountHolder || undefined, account_number: iban },
      default_for_currency: true,
    } as Stripe.AccountCreateExternalAccountParams);
  }

  if (input.company && !individual) {
    const c = input.company;
    await s.accounts.update(a.accountId, {
      company: { name: c.legalName || undefined, phone: c.phone || undefined, address: address(c), ...(c.vatId ? { vat_id: c.vatId } : {}) },
    });
  }

  const p = input.person;
  if (p || input.documentFileId) {
    const dob = p?.dob && /^\d{4}-\d{2}-\d{2}$/.test(p.dob) ? p.dob.split('-').map(Number) : null;
    const fields = {
      first_name: p?.firstName || undefined,
      last_name: p?.lastName || undefined,
      email: p?.email || undefined,
      phone: p?.phone || undefined,
      ...(dob ? { dob: { year: dob[0], month: dob[1], day: dob[2] } } : {}),
      ...(p?.street || p?.zip || p?.city ? { address: address({ ...(p as SignupDetails), country: home }) } : {}),
      ...(input.documentFileId ? { verification: { document: { front: input.documentFileId } } } : {}),
    };
    if (individual) {
      await s.accounts.update(a.accountId, { individual: fields });
    } else {
      // The salon's managing owner: representative, director, executive and owner in one.
      const people = await s.accounts.listPersons(a.accountId, { relationship: { representative: true }, limit: 1 });
      const rel = { representative: true, executive: true, director: true, owner: true, percent_ownership: 100, title: p?.title || 'Owner' };
      if (people.data[0]) await s.accounts.updatePerson(a.accountId, people.data[0].id, { ...fields, relationship: rel });
      else await s.accounts.createPerson(a.accountId, { ...fields, relationship: rel });
      await s.accounts.update(a.accountId, { company: { owners_provided: true, directors_provided: true, executives_provided: true } });
    }
  }
  const fresh = await s.accounts.retrieve(a.accountId);
  if (syncPayoutAccount(shopId, fresh).payoutsEnabled) await releaseWaitingPayouts(shopId);
}

/** An ID photo goes straight to Stripe; we keep only Stripe's file id. */
export async function uploadIdentityDocument(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error('file_too_large');
  if (!/^image\/(jpeg|png)$|^application\/pdf$/.test(file.type)) throw new Error('bad_file_type');
  const data = Buffer.from(await file.arrayBuffer());
  const f = await stripe().files.create({ purpose: 'identity_document', file: { data, name: file.name || 'id', type: file.type } });
  return f.id;
}
