import { NextRequest, NextResponse } from 'next/server';
import { rescheduleBooking, SlotTaken } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const { shopId, startsAt, deviceId } = body;
  if (typeof shopId !== 'string' || typeof startsAt !== 'number' || typeof deviceId !== 'string') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    rescheduleBooking(shopId, params.id, startsAt, null, { byDevice: deviceId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof SlotTaken) return NextResponse.json({ alternatives: e.alternatives }, { status: 409 });
    const msg = (e as Error).message;
    if (msg === 'too_late' || msg === 'not_yours') return NextResponse.json({ error: msg }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
