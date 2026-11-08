import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { rescheduleBooking, SlotTaken } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string; bid: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body?.startsAt) return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  try {
    const b = rescheduleBooking(params.id, params.bid, body.startsAt, body.staffId ?? null);
    return NextResponse.json({ id: b.id, startsAt: b.startsAt, staffId: b.staffId });
  } catch (e) {
    if (e instanceof SlotTaken) {
      return NextResponse.json({ error: 'slot_taken', alternatives: e.alternatives }, { status: 409 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
