import { NextRequest, NextResponse } from 'next/server';
import { bookSeries } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const { everyWeeks, count, deviceId } = body;
  if (typeof everyWeeks !== 'number' || typeof count !== 'number' || typeof deviceId !== 'string') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    const r = bookSeries(deviceId, params.id, everyWeeks, count);
    return NextResponse.json({ booked: r.booked.length, skippedDates: r.skippedDates });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
}
