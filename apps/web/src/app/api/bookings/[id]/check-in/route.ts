import { NextRequest, NextResponse } from 'next/server';
import { checkIn } from '@/core/store';
import { errStatus, ownBooking } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const own = ownBooking(params.id, body.deviceId);
  if ('error' in own) return own.error;
  try {
    const b = checkIn(params.id, body.deviceId);
    return NextResponse.json({ ok: true, status: b.status });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
