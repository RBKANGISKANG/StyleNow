import { NextRequest, NextResponse } from 'next/server';
import { setBookingStatus } from '@/core/store';
import { refundThroughStripe, sendPayout } from '@/lib/stripe-server';
import { errStatus } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

const ALLOWED = ['completed', 'no_show', 'cancelled_by_shop'] as const;

export async function POST(req: NextRequest, { params }: { params: { id: string; bid: string } }) {
  const body = await req.json().catch(() => ({}));
  if (!ALLOWED.includes(body.status)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  }
  try {
    const settledBy = body.settledBy === 'cash' || body.settledBy === 'card' ? body.settledBy : undefined;
    const b = setBookingStatus(params.id, params.bid, body.status, settledBy);
    // A shop calling a visit off owes the money back — send it, don't just
    // write it down. No-ops when the visit was never paid by card.
    const sent = b.status === 'completed' ? 0 : await refundThroughStripe(params.bid);
    // The visit happened: now the salon is paid. A no-show fee stays with the platform.
    if (b.status === 'completed') await sendPayout(params.bid);
    return NextResponse.json({
      id: b.id,
      status: b.status,
      cancellation: b.cancellation ?? null,
      stripeRefundedCents: sent,
    });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
