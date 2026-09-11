import { NextRequest, NextResponse } from 'next/server';
import { setRunningLate } from '@/core/store';

export const dynamic = 'force-dynamic';

/** "Stuck on the U-Bahn" — the floor must hear it, so it lands server-side. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.min !== 'number' || typeof body.deviceId !== 'string' || !body.deviceId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    const b = setRunningLate(params.id, body.deviceId, body.min);
    return NextResponse.json({ lateByMin: b.lateByMin ?? null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
