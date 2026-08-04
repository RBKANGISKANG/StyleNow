import { NextRequest, NextResponse } from 'next/server';
import { confirmBooking, HoldExpired } from '@/server/store';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const b = confirmBooking(params.id);
    return NextResponse.json({ id: b.id, reference: b.reference, status: b.status, paidCents: b.paidCents });
  } catch (e) {
    if (e instanceof HoldExpired) {
      return NextResponse.json({ error: 'hold_expired' }, { status: 410 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
