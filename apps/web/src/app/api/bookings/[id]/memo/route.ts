import { NextRequest, NextResponse } from 'next/server';
import { setCustomerMemo } from '@/core/store';
import { errStatus, ownBooking } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.text !== 'string') return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const own = ownBooking(params.id, body.deviceId);
  if ('error' in own) return own.error;
  try {
    setCustomerMemo(params.id, body.deviceId, body.text);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
