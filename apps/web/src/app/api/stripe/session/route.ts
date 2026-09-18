import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { originFor, settle, stripe, stripeConfigured } from '@/lib/stripe-server';
import { allShops, dueOnlineCents, getBooking, HoldExpired, type Booking } from '@/core/store';

export const dynamic = 'force-dynamic';

/** Every seat in one basket — a pair or a party pays once, not once per chair. */
function bookingsFrom(body: { bookingId?: unknown; bookingIds?: unknown }): string[] {
  const many = Array.isArray(body.bookingIds) ? body.bookingIds.map(String) : [];
  const one = body.bookingId ? [String(body.bookingId)] : [];
  return [...new Set([...one, ...many])].filter(Boolean).slice(0, 8);
}

function payable(b: Booking): { ok: true } | { ok: false; error: string; status: number } {
  if (b.status === 'confirmed') return { ok: false, error: 'already_confirmed', status: 409 };
  if (b.status !== 'hold' && b.status !== 'pending_payment') return { ok: false, error: 'hold_expired', status: 410 };
  if (b.holdExpiresAt && b.holdExpiresAt < Date.now()) return { ok: false, error: 'hold_expired', status: 410 };
  return { ok: true };
}

/**
 * Open a Stripe Checkout Session for the held seats.
 *
 * The amounts come from the engine, never from the request body — a client
 * that could name its own price would be the whole security model gone. The
 * booking ids ride along in metadata so the webhook and the return trip can
 * both find their way back without trusting the browser.
 */
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) return NextResponse.json({ error: 'stripe_not_configured' }, { status: 501 });
  const body = await req.json().catch(() => ({}));
  const ids = bookingsFrom(body);
  if (!ids.length) return NextResponse.json({ error: 'missing_booking' }, { status: 400 });

  const seats: Booking[] = [];
  for (const id of ids) {
    const b = getBooking(id);
    if (!b) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const check = payable(b);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    seats.push(b);
  }

  const lines = seats
    .map((b) => ({ b, amount: dueOnlineCents(b) }))
    .filter((x) => x.amount > 0);
  if (!lines.length) return NextResponse.json({ error: 'nothing_due' }, { status: 400 });

  const origin = originFor(req);
  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'embedded_page',
      line_items: lines.map(({ b, amount }) => {
        const shop = allShops().find((s) => s.id === b.shopId);
        const partial = b.quote.depositCents > 0 && b.quote.depositCents < b.quote.totalCents;
        return {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: amount,
            product_data: {
              name: `${partial ? 'Deposit · ' : ''}${shop?.name ?? 'StyleNow'}`,
              description: `${b.reference} · ${new Date(b.startsAt).toISOString().slice(0, 16).replace('T', ' ')}`,
            },
          },
        };
      }),
      // The seats are only held for eight minutes, so an abandoned session is
      // worth nothing soon after; letting Stripe expire it keeps the dashboard
      // honest. Thirty minutes is the shortest Stripe accepts.
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      metadata: { bookingIds: lines.map((l) => l.b.id).join(','), shopId: seats[0].shopId },
      payment_intent_data: { metadata: { bookingIds: lines.map((l) => l.b.id).join(',') } },
      return_url: `${origin}/api/stripe/session?id={CHECKOUT_SESSION_ID}&redirect=1`,
    });
    return NextResponse.json({ clientSecret: session.client_secret, sessionId: session.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/**
 * What became of a Checkout Session — and, when it was paid, the moment the
 * seats actually become bookings.
 *
 * Confirmation lives here rather than in the browser because the browser is
 * not a witness: it can close, lie, or never come back. The webhook confirms
 * the same way, and `confirmBooking` returns early on an already-confirmed
 * seat, so whichever arrives first wins and the second is harmless.
 */
export async function GET(req: NextRequest) {
  if (!stripeConfigured()) return NextResponse.json({ error: 'stripe_not_configured' }, { status: 501 });
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  const redirect = req.nextUrl.searchParams.get('redirect') === '1';
  try {
    const session = await stripe().checkout.sessions.retrieve(id, {
      expand: ['payment_intent.payment_method'],
    });
    const out = settle(session);
    if (redirect) {
      // Stripe sends the guest back here; hand them on to their own bookings,
      // which is where the confirmed seat now is.
      const to = new URL(`${originFor(req)}/bookings`);
      to.searchParams.set('stripe', out.paid ? 'paid' : 'open');
      if (out.reference) to.searchParams.set('ref', out.reference);
      return NextResponse.redirect(to, 303);
    }
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof HoldExpired) return NextResponse.json({ error: 'hold_expired' }, { status: 410 });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
