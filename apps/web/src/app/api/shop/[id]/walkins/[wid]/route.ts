import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { removeWalkIn, setWalkInState, type WalkInEntry } from '@/core/store';
import { errStatus } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string; wid: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (!['queued', 'serving', 'done'].includes(body.state)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  try {
    setWalkInState(params.id, params.wid, body.state as WalkInEntry['state']);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string; wid: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  removeWalkIn(params.id, params.wid);
  return NextResponse.json({ ok: true });
}
