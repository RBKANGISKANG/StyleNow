import { NextRequest, NextResponse } from 'next/server';
import { setBookingStatus } from '@/core/store';

export const dynamic = 'force-dynamic';

const ALLOWED = ['completed', 'no_show', 'cancelled_by_shop'] as const;

export async function POST(req: NextRequest, { params }: { params: { id: string; bid: string } }) {
  const body = await req.json().catch(() => ({}));
  if (!ALLOWED.includes(body.status)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  }
  try {
    const b = setBookingStatus(params.id, params.bid, body.status);
    return NextResponse.json({ id: b.id, status: b.status, cancellation: b.cancellation ?? null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
