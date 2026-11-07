import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { buyCorporateBatch, corporateBatchesForShop, CORP_MIN_CARDS, CORP_MAX_CARDS, GIFT_MIN_CENTS, GIFT_MAX_CENTS } from '@/core/store';
import { cleanPayment, errStatus, stripeGuard } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** The shop's B2B view: orders, revenue, outstanding liability. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  return NextResponse.json(corporateBatchesForShop(params.id));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const count = Number(body.count);
  const amountCents = Number(body.amountCents);
  if (typeof body.company !== 'string' || !body.company.trim() || typeof body.deviceId !== 'string' || !body.deviceId) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  if (!Number.isInteger(count) || count < CORP_MIN_CARDS || count > CORP_MAX_CARDS) {
    return NextResponse.json({ error: 'bad_count' }, { status: 400 });
  }
  if (!Number.isInteger(amountCents) || amountCents < GIFT_MIN_CENTS || amountCents > GIFT_MAX_CENTS) {
    return NextResponse.json({ error: 'bad_amount' }, { status: 400 });
  }
  const blocked = stripeGuard(body.payment);
  if (blocked) return blocked;
  const payment = cleanPayment(body.payment);
  if (body.payment != null && !payment) {
    return NextResponse.json({ error: 'bad_payment' }, { status: 400 });
  }
  try {
    const batch = buyCorporateBatch(params.id, body.deviceId, body.company, count, amountCents, payment);
    return NextResponse.json({ batch }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
