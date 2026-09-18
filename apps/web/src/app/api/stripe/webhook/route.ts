import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { settle, stripe, stripeConfigured } from '@/lib/stripe-server';

export const dynamic = 'force-dynamic';

/**
 * Stripe telling us what happened, which is the only account of a payment we
 * can actually rely on: a guest can close the tab between paying and being
 * sent back, and then the return page never runs. `settle` is idempotent, so
 * whichever of the two gets here first confirms the booking and the other is a
 * no-op.
 *
 * The signature check is not optional — without it this endpoint is a public
 * "mark any booking paid" button. With no STRIPE_WEBHOOK_SECRET configured we
 * refuse rather than trust the body.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) return NextResponse.json({ error: 'stripe_not_configured' }, { status: 501 });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'webhook_secret_missing' }, { status: 501 });
  const signature = req.headers.get('stripe-signature') ?? '';
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(raw, signature, secret);
  } catch (e) {
    return NextResponse.json({ error: `bad_signature: ${(e as Error).message}` }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const lean = event.data.object as Stripe.Checkout.Session;
    // The event payload is not expanded, so re-read the session to learn which
    // payment method was actually used before stamping it on the booking.
    const full = await stripe().checkout.sessions.retrieve(lean.id, {
      expand: ['payment_intent.payment_method'],
    });
    settle(full);
  }

  return NextResponse.json({ received: true });
}
