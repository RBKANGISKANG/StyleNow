import { NextRequest, NextResponse } from 'next/server';
import { stripe, stripeConfigured } from '@/lib/stripe-server';
import { getBooking, markStripeRefunded, stripeRefundableCents } from '@/core/store';

export const dynamic = 'force-dynamic';

/**
 * Give money back through the rails it arrived on.
 *
 * The engine has already decided what is owed — fee kept, rest returned — so
 * this route never takes an amount from the caller. It asks the engine how
 * much of that refund is Stripe's to give (a gift card or loyalty points paid
 * their share in our own books, not on anyone's card) and sends exactly that.
 * The amount is booked against the charge before we answer, so a double-tap
 * cannot refund twice.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) return NextResponse.json({ error: 'stripe_not_configured' }, { status: 501 });
  const body = await req.json().catch(() => ({}));
  const bookingId = String(body.bookingId ?? '');
  const b = getBooking(bookingId);
  if (!b) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!b.stripe?.paymentIntentId) return NextResponse.json({ refundedCents: 0, reason: 'no_card_payment' });

  const cents = stripeRefundableCents(bookingId);
  if (cents <= 0) return NextResponse.json({ refundedCents: 0, reason: 'nothing_to_refund' });

  try {
    const refund = await stripe().refunds.create(
      { payment_intent: b.stripe.paymentIntentId, amount: cents, metadata: { bookingId } },
      // Two clicks on "cancel" must not become two refunds, even if the first
      // response never reached the caller.
      { idempotencyKey: `refund-${bookingId}-${b.stripe.refundedCents}-${cents}` },
    );
    markStripeRefunded(bookingId, cents);
    return NextResponse.json({ refundedCents: cents, refundId: refund.id, status: refund.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
