import { NextRequest, NextResponse } from 'next/server';
import { setBookingStatus } from '@/core/store';
import { refundThroughStripe } from '@/lib/stripe-server';

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
    return NextResponse.json({
      id: b.id,
      status: b.status,
      cancellation: b.cancellation ?? null,
      stripeRefundedCents: sent,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
