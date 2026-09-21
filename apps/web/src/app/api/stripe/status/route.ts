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
 *
 * Booking ids are sequential and therefore guessable, and this answer
 * includes a paid amount and a confirmation reference — real financial facts
 * about a specific person. deviceId is required and must match every seat
 * asked about, the same ownership check confirmBooking's callers already
 * expect; nothing here is public the way the shop-facing policies route is.
 */
export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId') ?? '';
  const ids = (req.nextUrl.searchParams.get('bookingIds') ?? req.nextUrl.searchParams.get('bookingId') ?? '')
    .split(',')
    .filter(Boolean)
    .slice(0, 8);
  if (!deviceId) return NextResponse.json({ error: 'missing_device' }, { status: 400 });
  const seats = ids.map((id) => getBooking(id)).filter((b) => b && b.deviceId === deviceId);
  if (!seats.length) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // The basket was one payment, so it is paid when every seat in it is.
  const paid = seats.every((b) => b!.status === 'confirmed');
  return NextResponse.json({
    paid,
    reference: paid ? (seats[0]!.reference ?? '') : '',
    statuses: seats.map((b) => ({ id: b!.id, status: b!.status, paidCents: b!.paidCents })),
  });
}
