import { NextRequest, NextResponse } from 'next/server';
import { buyPackage, packageOffers, packagesForShop } from '@/core/store';
import { cleanPayment, errStatus, stripeGuard } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.offerId !== 'string' || typeof body.deviceId !== 'string' || !body.deviceId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const blocked = stripeGuard(body.payment);
  if (blocked) return blocked;
  const payment = cleanPayment(body.payment);
  if (body.payment != null && !payment) return NextResponse.json({ error: 'bad_payment' }, { status: 400 });
  try {
    const pkg = buyPackage(params.id, body.offerId, body.deviceId, payment);
    return NextResponse.json({ pkg }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}

/** The shop's offers, and its sold-package stats. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ offers: packageOffers(params.id), stats: packagesForShop(params.id) });
}
