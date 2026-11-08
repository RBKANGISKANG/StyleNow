import { NextRequest, NextResponse } from 'next/server';
import { openDispute, type DisputeKind } from '@/core/store';
import { errStatus, ownBooking } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

const KINDS: DisputeKind[] = ['result', 'fee', 'other'];

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const body = await req.json().catch(() => ({}));
  if (!KINDS.includes(body.kind) || typeof body.text !== 'string') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const own = ownBooking(params.id, body.deviceId);
  if ('error' in own) return own.error;
  try {
    const dispute = openDispute(params.id, body.deviceId, body.kind, body.text);
    return NextResponse.json({ dispute }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
