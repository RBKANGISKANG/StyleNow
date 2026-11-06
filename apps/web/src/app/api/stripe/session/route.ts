import { NextRequest, NextResponse } from 'next/server';
import { originFor, settle, stripe, stripeConfigured } from '@/lib/stripe-server';
import { allShops, dueOnlineCents, extendHold, getBooking, HoldExpired, type Booking } from '@/core/store';

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

// Stripe's own minimum Checkout Session lifetime is 30 minutes; a five-minute
// buffer on top covers the gap between the session actually expiring and a
// guest's last click landing, without leaving the seat held indefinitely.
const SESSION_MINUTES = 30;
const HOLD_BUFFER_MINUTES = 5;

/**
 * Open a Stripe Checkout Session for the held seats.
 *
 * The amounts come from the engine, never from the request body — a client
 * that could name its own price would be the whole security model gone. The
 * booking ids ride along in metadata so the webhook and the return trip can
 * both find their way back without trusting the browser, and the exact
 * amount charged per seat rides along too — frozen now, at the only moment
 * it is actually known to equal what Stripe was asked for.
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

  // Every seat, including one that costs nothing online (fully covered by a
  // voucher, points, or a stamp reward) — that seat still needs confirming
  // once the party pays, it just never gets a Stripe line item of its own.
  const amounts: Record<string, number> = {};
  for (const b of seats) {
    const due = dueOnlineCents(b);
    if (due > 0) amounts[b.id] = due;
  }
  const lineSeats = seats.filter((b) => amounts[b.id] > 0);
  if (!lineSeats.length) return NextResponse.json({ error: 'nothing_due' }, { status: 400 });

  const origin = originFor(req);
  const expiresAtSec = Math.floor(Date.now() / 1000) + SESSION_MINUTES * 60;
  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      ui_mode: 'embedded_page',
      // Restricted to card (which also covers Apple Pay / Google Pay — both
      // confirm inline, same as a card) rather than Stripe's automatic
      // method selection. This app's seat hold is a short-lived, real-time
      // contract; a redirect or delayed-confirmation method (SEPA debit,
      // bank redirects) can settle hours or days after checkout, long after
      // any hold extension here could plausibly cover, leaving a genuine
      // charge with no seat and no automatic way back to the customer.
      payment_method_types: ['card'],
      line_items: lineSeats.map((b) => {
        const shop = allShops().find((s) => s.id === b.shopId);
        const partial = b.quote.depositCents > 0 && b.quote.depositCents < b.quote.totalCents;
        return {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: amounts[b.id],
            product_data: {
              name: `${partial ? 'Deposit · ' : ''}${shop?.name ?? 'StyleNow'}`,
              description: `${b.reference} · ${new Date(b.startsAt).toISOString().slice(0, 16).replace('T', ' ')}`,
            },
          },
        };
      }),
      expires_at: expiresAtSec,
      metadata: {
        bookingIds: ids.join(','),
        bookingAmounts: JSON.stringify(amounts),
        shopId: seats[0].shopId,
      },
      payment_intent_data: { metadata: { bookingIds: ids.join(',') } },
      return_url: `${origin}/api/stripe/session?id={CHECKOUT_SESSION_ID}&redirect=1`,
    });
    // The seat hold is 8 minutes; this session can legitimately still be open
    // at 25. Stretch every seat's hold to outlast the session itself, so a
    // slow-but-genuine payer isn't charged for a seat the engine already
    // gave away.
    for (const id of ids) extendHold(id, (expiresAtSec + HOLD_BUFFER_MINUTES * 60) * 1000);
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
    const out = await settle(session);
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
