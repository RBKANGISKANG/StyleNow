import { NextRequest, NextResponse } from 'next/server';
import { submitShopApplication, applicationsForDevice, shopById } from '@/core/store';
import { stripeConfigured } from '@/lib/stripe-server';
import { createCustomAccount, detailsFromApplication } from '@/lib/stripe-connect';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.deviceId || !body?.data) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  const application = submitShopApplication(body.deviceId, body.data);
  const live = application.shopId ? shopById(application.shopId) : undefined;
  // Payouts without ever visiting Stripe: the IBAN rides along once, goes
  // straight to Stripe and is never stored here. A failure never blocks the
  // sign-up — the dashboard's payout form can finish it later.
  let payouts: 'created' | 'later' = 'later';
  const iban = typeof body.payout?.iban === 'string' ? body.payout.iban : '';
  if (live && stripeConfigured() && iban) {
    try {
      const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.ip || '';
      await createCustomAccount(live.id, { ...detailsFromApplication(body.data), iban }, ip);
      payouts = 'created';
    } catch (e) {
      console.error('[stylenow] payout account not created at sign-up:', (e as Error).message);
    }
  }
  return NextResponse.json(
    { application, shop: live ? { id: live.id, slug: live.slug } : null, payouts },
    { status: 201 },
  );
}

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json({ error: 'missing_device' }, { status: 400 });
  return NextResponse.json({ applications: applicationsForDevice(deviceId) });
}
