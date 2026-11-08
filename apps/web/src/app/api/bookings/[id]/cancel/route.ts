import { NextRequest, NextResponse } from 'next/server';
import { cancelBooking, CANCEL_REASONS, type CancelReason } from '@/core/store';
import { refundThroughStripe } from '@/lib/stripe-server';
import { errStatus, ownBooking } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/**
 * Customer-side cancellation only — the booking's own device. The shop calls
 * a visit off through /api/shop/[id]/bookings/[bid]/status (cancelled_by_shop).
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const body = await req.json().catch(() => ({}));
  const own = ownBooking(params.id, body.deviceId);
  if ('error' in own) return own.error;
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
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
