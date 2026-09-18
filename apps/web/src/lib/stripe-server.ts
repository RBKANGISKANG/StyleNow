/**
 * The real processor, when there is one.
 *
 * StyleNow runs in three shapes: a static export with no server at all, a
 * Next.js server with `/api` routes, and Supabase. Only the middle one can
 * hold a secret key, so Stripe is wired there and the demo checkout stays the
 * fallback everywhere else. Nothing in this module is imported by client code
 * — the secret key must never reach a browser bundle.
 *
 * Configure it by setting STRIPE_SECRET_KEY (and, for the client, the
 * publishable key in NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY). With neither set the
 * app behaves exactly as it did before: a demo form that charges nobody.
 */
import Stripe from 'stripe';
import {
  confirmBooking,
  dueOnlineCents,
  getBooking,
  markStripeRefunded,
  recordStripeCharge,
  stripeRefundableCents,
  type PaymentMethod,
} from '@/core/store';

const METHODS: PaymentMethod[] = ['card', 'paypal', 'apple_pay', 'google_pay', 'sepa', 'at_salon'];

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && publishableKey());
}

export function publishableKey(): string {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
}

/** The SDK, built once. Throws rather than half-working with no key. */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('stripe_not_configured');
  if (!client) client = new Stripe(key, { typescript: true });
  return client;
}

/**
 * Where Stripe sends the guest back to. Behind a proxy the request's own host
 * is the only honest answer, but an explicitly configured origin wins so a
 * deployment can pin it.
 */
export function originFor(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (configured) return configured.replace(/\/$/, '');
  const proto = req.headers.get('x-forwarded-proto') ?? 'http';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}

/**
 * Push whatever the engine decided to give back out through Stripe.
 *
 * Called after a cancellation is committed, on the server, so the money moves
 * without anyone having to remember to press a second button. It never decides
 * an amount itself — `stripeRefundableCents` does, clamped to what the card
 * actually paid — and it never throws: a booking that was cancelled must stay
 * cancelled even if the processor is having a bad afternoon. What is left in
 * that case is a refund our books owe and Stripe has not sent, which the next
 * call will pick up because nothing was marked as refunded.
 */
export async function refundThroughStripe(bookingId: string): Promise<number> {
  if (!stripeConfigured()) return 0;
  const b = getBooking(bookingId);
  if (!b?.stripe?.paymentIntentId) return 0;
  const cents = stripeRefundableCents(bookingId);
  if (cents <= 0) return 0;
  try {
    await stripe().refunds.create(
      { payment_intent: b.stripe.paymentIntentId, amount: cents, metadata: { bookingId } },
      { idempotencyKey: `refund-${bookingId}-${b.stripe.refundedCents}-${cents}` },
    );
    markStripeRefunded(bookingId, cents);
    return cents;
  } catch {
    return 0;
  }
}

/**
 * A human-readable, storable label for what was actually used — the same shape
 * the demo checkout produces ("Visa ····4242"), so everything downstream that
 * groups revenue by method keeps working unchanged.
 */
export function labelForCharge(pm: Stripe.PaymentMethod | null): { method: string; label: string } {
  if (!pm) return { method: 'card', label: 'Card' };
  switch (pm.type) {
    case 'card': {
      const brand = pm.card?.brand ?? 'card';
      const name = brand.charAt(0).toUpperCase() + brand.slice(1);
      const wallet = pm.card?.wallet?.type;
      if (wallet === 'apple_pay') return { method: 'apple_pay', label: `Apple Pay ····${pm.card?.last4 ?? ''}` };
      if (wallet === 'google_pay') return { method: 'google_pay', label: `Google Pay ····${pm.card?.last4 ?? ''}` };
      return { method: 'card', label: `${name} ····${pm.card?.last4 ?? ''}` };
    }
    case 'sepa_debit':
      return { method: 'sepa', label: `SEPA ··${pm.sepa_debit?.last4 ?? ''}` };
    case 'paypal':
      return { method: 'paypal', label: 'PayPal' };
    default:
      return { method: 'card', label: pm.type.replace(/_/g, ' ') };
  }
}

/** Turn a paid session into confirmed bookings. Safe to run more than once. */
export function settle(session: Stripe.Checkout.Session): {
  status: string;
  paid: boolean;
  bookingIds: string[];
  reference: string;
} {
  const ids = (session.metadata?.bookingIds ?? '').split(',').filter(Boolean);
  const paid = session.status === 'complete' && session.payment_status === 'paid';
  if (paid) {
    const pi = session.payment_intent;
    const intent = typeof pi === 'string' ? null : pi;
    const pm = intent && typeof intent.payment_method !== 'string' ? intent.payment_method : null;
    const { method, label } = labelForCharge(pm);
    const payment = {
      method: (METHODS.includes(method as PaymentMethod) ? method : 'card') as PaymentMethod,
      label: label.slice(0, 40),
    };
    for (const id of ids) {
      const b = getBooking(id);
      if (!b) continue;
      // Each seat carries its own share of the charge, so a later refund for
      // one chair cannot reach further than that chair's money.
      recordStripeCharge(id, {
        sessionId: session.id,
        paymentIntentId: typeof pi === 'string' ? pi : (intent?.id ?? ''),
        chargedCents: dueOnlineCents(b),
      });
      try {
        confirmBooking(id, payment);
      } catch {
        // one seat's hold lapsed between paying and settling — the others
        // still stand, and the lapsed one shows up as unconfirmed
      }
    }
  }
  const first = ids.map((i) => getBooking(i)).find((b) => b?.status === 'confirmed');
  return {
    status: String(session.status ?? 'open'),
    paid,
    bookingIds: ids,
    reference: first?.reference ?? '',
  };
}
