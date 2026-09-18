'use client';
/**
 * The real checkout, when a processor is configured.
 *
 * Stripe's embedded form is mounted in an iframe on our own page rather than
 * as a redirect, because the seat is only held for eight minutes and sending
 * someone away to a different site mid-hold is how bookings get lost. Card
 * details go straight from that iframe to Stripe and never touch our server,
 * which is the entire point — we stay out of PCI scope.
 *
 * The booking is confirmed on the server, from the Checkout Session, not from
 * anything this component says. A browser is not a witness.
 */
import { useCallback, useEffect, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { useI18n } from '@/lib/i18n';

let stripePromise: Promise<Stripe | null> | null = null;
function stripeFor(key: string): Promise<Stripe | null> {
  if (!stripePromise) stripePromise = loadStripe(key);
  return stripePromise;
}

export function StripeCheckout({
  publishableKey,
  bookingIds,
  onPaid,
  onExpired,
}: {
  publishableKey: string;
  /** Every seat in the basket — a pair or a party pays once, not per chair. */
  bookingIds: string[];
  /** The seat is confirmed on the server; this just moves the screen on. */
  onPaid: (reference: string) => void;
  onExpired: () => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState('');

  const fetchClientSecret = useCallback(async () => {
    const res = await fetch('/api/stripe/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingIds }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.error === 'hold_expired') onExpired();
      else setError(String(data.error ?? 'stripe_error'));
      throw new Error(String(data.error ?? 'stripe_error'));
    }
    return String(data.clientSecret ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingIds.join(','), onExpired]);

  // Card payments finish inside the iframe without ever leaving the page, so
  // there is no redirect to learn from — poll the session until the server
  // says it is paid. Redirect-based methods come back through the return URL
  // and land on the same answer.
  useEffect(() => {
    let alive = true;
    let tries = 0;
    const tick = async () => {
      if (!alive || tries++ > 240) return;
      try {
        const res = await fetch(`/api/stripe/status?bookingIds=${encodeURIComponent(bookingIds.join(','))}`);
        const data = await res.json().catch(() => ({}));
        if (alive && data.paid) { onPaid(String(data.reference ?? '')); return; }
      } catch {
        // a blip between polls is not worth telling anyone about
      }
      if (alive) window.setTimeout(() => void tick(), 2000);
    };
    const id = window.setTimeout(() => void tick(), 2000);
    return () => { alive = false; window.clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingIds.join(','), onPaid]);

  if (error) return <p className="panel" style={{ color: 'var(--danger)' }}>{t('st_error')}</p>;

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <EmbeddedCheckoutProvider stripe={stripeFor(publishableKey)} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
