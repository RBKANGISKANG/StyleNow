import { NextRequest, NextResponse } from 'next/server';
import { setWouldRepeat } from '@/core/store';
import { errStatus, ownBooking } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.on !== 'boolean') return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const own = ownBooking(params.id, body.deviceId);
  if ('error' in own) return own.error;
  try {
    setWouldRepeat(params.id, body.deviceId, body.on);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
