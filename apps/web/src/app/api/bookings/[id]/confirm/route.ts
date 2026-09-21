import { NextRequest, NextResponse } from 'next/server';
import { confirmBooking, HoldExpired, type PaymentMethod } from '@/core/store';
import { stripeConfigured } from '@/lib/stripe-server';

const METHODS: PaymentMethod[] = ['card', 'paypal', 'apple_pay', 'google_pay', 'sepa', 'at_salon'];
// Confirming as paid by one of these was always trust-the-client — fine while
// the whole checkout was a demo with no processor behind it ("only a masked
// label is accepted here — the client never sends a full PAN"). Once Stripe
// is configured, that same trust becomes a real hole: anyone who knows a
// hold's booking id (which they always do, from their own apiHold call) can
// POST {method:'card'} here directly and walk away with a booking marked
// paid in full, with zero money ever reaching Stripe. Only at_salon — which
// confirmBooking gates for real, against the shop's own setting and any
// deposit requirement — is still this route's business once a real
// processor exists; everything else must go through the verified Stripe
// session/webhook path instead.
const ONLINE_METHODS: PaymentMethod[] = ['card', 'paypal', 'apple_pay', 'google_pay', 'sepa'];

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (stripeConfigured() && body?.payment && ONLINE_METHODS.includes(body.payment.method)) {
    return NextResponse.json({ error: 'use_stripe_checkout' }, { status: 403 });
  }
  // only a masked label is accepted here — the client never sends a full PAN
  const payment =
    body?.payment && METHODS.includes(body.payment.method) && typeof body.payment.label === 'string'
      ? { method: body.payment.method as PaymentMethod, label: String(body.payment.label).slice(0, 40) }
      : undefined;
  try {
    const b = confirmBooking(params.id, payment);
    return NextResponse.json({ id: b.id, reference: b.reference, status: b.status, paidCents: b.paidCents });
  } catch (e) {
    if (e instanceof HoldExpired) {
      return NextResponse.json({ error: 'hold_expired' }, { status: 410 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
