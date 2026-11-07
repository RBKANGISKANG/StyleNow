import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { convertWalkIn } from '@/core/store';
import { errStatus } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string; wid: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  try {
    const b = convertWalkIn(params.id, params.wid);
    return NextResponse.json({ ok: true, reference: b.reference });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
