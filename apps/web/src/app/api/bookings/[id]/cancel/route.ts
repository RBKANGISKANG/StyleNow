import { NextRequest, NextResponse } from 'next/server';
import { cancelBooking, CANCEL_REASONS, type CancelReason } from '@/core/store';
import { refundThroughStripe } from '@/lib/stripe-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const preview = Boolean(body.preview);
  try {
    const { feeCents, refundCents, reason, booking } = cancelBooking(params.id, {
      preview,
      by: 'customer',
      reason: CANCEL_REASONS.includes(body.reason) ? (body.reason as CancelReason) : undefined,
    });
    // A refund the books record but nobody sends is not a refund. Push it out
    // through the same card it came in on, for real, before answering.
    const sent = preview ? 0 : await refundThroughStripe(params.id);
    return NextResponse.json({ feeCents, refundCents, reason, status: booking.status, stripeRefundedCents: sent });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
