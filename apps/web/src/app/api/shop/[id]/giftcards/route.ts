import { NextRequest, NextResponse } from 'next/server';
import { buyGiftCard, giftCardsForShop, GIFT_MIN_CENTS, GIFT_MAX_CENTS } from '@/core/store';

export const dynamic = 'force-dynamic';

/** The shop's liability view: everything sold, and what is still unredeemed. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json(giftCardsForShop(params.id));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents < GIFT_MIN_CENTS || amountCents > GIFT_MAX_CENTS) {
    return NextResponse.json({ error: 'bad_amount' }, { status: 400 });
  }
  if (typeof body.deviceId !== 'string' || !body.deviceId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
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
      body.payment && typeof body.payment.label === 'string'
        ? { method: body.payment.method, label: String(body.payment.label).slice(0, 40) }
        : undefined,
    );
    return NextResponse.json({ card });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
