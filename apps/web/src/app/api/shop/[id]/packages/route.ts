import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { buyPackage, deletePackageOffer, packageOffers, packagesForShop, savePackageOffer } from '@/core/store';
import { badRequest, cleanPayment, errStatus, fail, isStr, stripeGuard } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return NextResponse.json({ offers: packageOffers(params.id), stats: packagesForShop(params.id) });
}

/** Create or update an offer: { offer: { id?, serviceId, count, priceCents } }. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const o = body.offer;
  if (!o || typeof o !== 'object' || !isStr(o.serviceId) || typeof o.count !== 'number' || typeof o.priceCents !== 'number') {
    return badRequest();
  }
  if (o.id != null && !isStr(o.id)) return badRequest();
  try {
    const offer = savePackageOffer(params.id, { id: o.id, serviceId: o.serviceId, count: o.count, priceCents: o.priceCents });
    return NextResponse.json({ offer });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const offerId = req.nextUrl.searchParams.get('offerId');
  if (!offerId) return badRequest();
  deletePackageOffer(params.id, offerId);
  return NextResponse.json({ ok: true });
}
