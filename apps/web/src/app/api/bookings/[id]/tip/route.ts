import { NextRequest, NextResponse } from 'next/server';
import { setTip } from '@/core/store';
import { errStatus, ownBooking } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.tipCents !== 'number' || body.tipCents < 0) {
    return NextResponse.json({ error: 'invalid_tip' }, { status: 400 });
  }
  const own = ownBooking(params.id, body.deviceId);
  if ('error' in own) return own.error;
  try {
    const b = setTip(params.id, body.tipCents);
    return NextResponse.json({ tipCents: b.tipCents });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
