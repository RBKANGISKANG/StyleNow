import { NextRequest, NextResponse } from 'next/server';
import { requireShopAccess } from '@/app/api/_lib/guards';
import { payoutAccount, shopById, commissionFreeUntil, PLATFORM_COMMISSION_PCT, waitingPayouts } from '@/core/store';
import { stripeConfigured } from '@/lib/stripe-server';
import { accountNeeds, createCustomAccount, ibanOk, updateAccount, uploadIdentityDocument, type DueGroup, type PersonDetails, type SignupDetails } from '@/lib/stripe-connect';

export const dynamic = 'force-dynamic';

/**
 * Salon payouts, all inside StyleNow (Stripe Connect Custom accounts — the
 * salon never visits Stripe).
 *
 * GET  ?shopId&ownerKey            → status + which details are still needed
 * POST json { shopId, ownerKey, company?, person?, iban?, accountHolder? }
 *                                   → create the account or fill in details
 * POST multipart (shopId, ownerKey, document) → upload an ID photo
 */
function guard(req: NextRequest, shopId: string): NextResponse | null {
  if (!shopById(shopId)) return NextResponse.json({ error: 'shop_not_found' }, { status: 404 });
  return requireShopAccess(req, shopId);
}

const clientIp = (req: NextRequest) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || '';

async function view(shopId: string) {
  const a = payoutAccount(shopId);
  let needs: { groups: DueGroup[]; raw: string[]; deadline: number | null; disabledReason: string | null } = { groups: [], raw: [], deadline: null, disabledReason: null };
  if (stripeConfigured()) {
    try {
      needs = await accountNeeds(shopId);
    } catch {
      /* keep the last known status */
    }
  }
  const fresh = payoutAccount(shopId) ?? a;
  return {
    configured: stripeConfigured(),
    connected: Boolean(fresh),
    payoutsEnabled: fresh?.payoutsEnabled ?? false,
    chargesEnabled: fresh?.chargesEnabled ?? false,
    detailsSubmitted: fresh?.detailsSubmitted ?? false,
    needs: needs.groups,
    deadline: needs.deadline,
    disabledReason: needs.disabledReason,
    waitingCents: waitingPayouts(shopId).reduce((n, b) => n + (b.payout?.cents ?? 0), 0),
    commissionPct: PLATFORM_COMMISSION_PCT,
    freeUntil: commissionFreeUntil(shopId),
  };
}

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId') ?? '';
  const refused = guard(req, shopId);
  if (refused) return refused;
  return NextResponse.json(await view(shopId));
}

const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

export async function POST(req: NextRequest) {
  if (!stripeConfigured()) return NextResponse.json({ error: 'stripe_not_configured' }, { status: 501 });
  try {
    if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      const form = await req.formData();
      const shopId = String(form.get('shopId') ?? '');
      const refused = guard(req, shopId);
      if (refused) return refused;
      const file = form.get('document');
      if (!(file instanceof File)) return NextResponse.json({ error: 'missing_document' }, { status: 400 });
      await updateAccount(shopId, { documentFileId: await uploadIdentityDocument(file) });
      return NextResponse.json(await view(shopId));
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const shopId = str(body.shopId) ?? '';
    const refused = guard(req, shopId);
    if (refused) return refused;
    const iban = str(body.iban, 42);
    if (iban && !ibanOk(iban)) return NextResponse.json({ error: 'bad_iban' }, { status: 400 });
    const c = (body.company ?? null) as Record<string, unknown> | null;
    const company: SignupDetails | undefined = c
      ? { legalName: str(c.legalName), phone: str(c.phone, 30), vatId: str(c.vatId, 20), street: str(c.street), zip: str(c.zip, 12), city: str(c.city, 60), email: str(c.email), website: str(c.website), smallBusiness: Boolean(c.smallBusiness) }
      : undefined;
    const p = (body.person ?? null) as Record<string, unknown> | null;
    const person: PersonDetails | undefined = p
      ? { firstName: str(p.firstName, 60), lastName: str(p.lastName, 60), dob: str(p.dob, 10), email: str(p.email), phone: str(p.phone, 30), street: str(p.street), zip: str(p.zip, 12), city: str(p.city, 60), title: str(p.title, 40) }
      : undefined;

    // Stripe's ready-made test document ids (test mode only) can be passed directly.
    const testDoc = typeof body.documentFileId === 'string' && /^file_identity_document_/.test(body.documentFileId) && (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_test_') ? body.documentFileId : undefined;
    if (!payoutAccount(shopId)) {
      await createCustomAccount(shopId, { ...(company ?? {}), displayName: shopById(shopId)!.name, iban, accountHolder: str(body.accountHolder) }, clientIp(req));
      if (person || testDoc) await updateAccount(shopId, { person, documentFileId: testDoc });
    } else {
      await updateAccount(shopId, { company, person, iban, accountHolder: str(body.accountHolder), documentFileId: testDoc });
    }
    return NextResponse.json(await view(shopId));
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === 'bad_iban' || msg.startsWith('bad_') || msg === 'file_too_large' ? 400 : 502 });
  }
}
