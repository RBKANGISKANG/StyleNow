import { NextRequest, NextResponse } from 'next/server';
import { cancelBooking, CANCEL_REASONS, type CancelReason } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  try {
    const { feeCents, refundCents, reason, booking } = cancelBooking(params.id, {
      preview: Boolean(body.preview),
      by: 'customer',
      reason: CANCEL_REASONS.includes(body.reason) ? (body.reason as CancelReason) : undefined,
    });
    return NextResponse.json({ feeCents, refundCents, reason, status: booking.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
