import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { buyGiftCard, giftCardsForShop, sellGiftCardAtCounter, GIFT_MIN_CENTS, GIFT_MAX_CENTS } from '@/core/store';
import { badRequest, cleanPayment, isStr, stripeGuard } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** The shop's liability view: everything sold, and what is still unredeemed. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  return NextResponse.json(giftCardsForShop(params.id));
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const body = await req.json().catch(() => ({}));
  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents < GIFT_MIN_CENTS || amountCents > GIFT_MAX_CENTS) {
    return NextResponse.json({ error: 'bad_amount' }, { status: 400 });
  }
  if (typeof body.deviceId !== 'string' || !body.deviceId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const blocked = stripeGuard(body.payment);
  if (blocked) return blocked;
  if (body.payment != null && !cleanPayment(body.payment)) {
    return NextResponse.json({ error: 'bad_payment' }, { status: 400 });
  }
  try {
    const card = buyGiftCard(
      params.id,
      body.deviceId,
      amountCents,
      {
        toName: typeof body.toName === 'string' ? body.toName.slice(0, 60) : undefined,
        fromName: typeof body.fromName === 'string' ? body.fromName.slice(0, 60) : undefined,
        message: typeof body.message === 'string' ? body.message.slice(0, 200) : undefined,
      },
      cleanPayment(body.payment),
    );
    return NextResponse.json({ card });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** A card sold over the counter (paid at the salon): { amountCents, toName? }. */
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (typeof body.amountCents !== 'number' || (body.toName != null && !isStr(body.toName))) return badRequest();
  try {
    return NextResponse.json({ card: sellGiftCardAtCounter(params.id, body.amountCents, body.toName ?? undefined) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
