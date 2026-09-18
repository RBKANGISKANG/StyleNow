import { NextRequest, NextResponse } from 'next/server';
import { getBooking } from '@/core/store';

export const dynamic = 'force-dynamic';

/**
 * Have these seats been paid for yet?
 *
 * Answered from our own bookings, not from Stripe, so the checkout page can
 * ask every couple of seconds without spending an API call each time. A
 * booking only reaches 'confirmed' once the server has settled a real Checkout
 * Session — on the return trip or through the webhook — so this reports that,
 * it is never a shortcut around it.
 */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get('bookingIds') ?? req.nextUrl.searchParams.get('bookingId') ?? '')
    .split(',')
    .filter(Boolean)
    .slice(0, 8);
  const seats = ids.map((id) => getBooking(id)).filter(Boolean);
  if (!seats.length) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // The basket was one payment, so it is paid when every seat in it is.
  const paid = seats.every((b) => b!.status === 'confirmed');
  return NextResponse.json({
    paid,
    reference: paid ? (seats[0]!.reference ?? '') : '',
    statuses: seats.map((b) => ({ id: b!.id, status: b!.status, paidCents: b!.paidCents })),
  });
}
