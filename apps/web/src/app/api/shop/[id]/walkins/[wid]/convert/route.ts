import { NextRequest, NextResponse } from 'next/server';
import { convertWalkIn } from '@/core/store';
import { errStatus } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string; wid: string } }) {
  try {
    const b = convertWalkIn(params.id, params.wid);
    return NextResponse.json({ ok: true, reference: b.reference });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
