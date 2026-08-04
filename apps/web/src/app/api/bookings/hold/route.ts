import { NextRequest, NextResponse } from 'next/server';
import { createHold, SlotTaken } from '@/server/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const idempotencyKey = req.headers.get('idempotency-key');
  if (!idempotencyKey) {
    return NextResponse.json({ error: 'idempotency_key_required' }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (!body?.shopId || !body?.serviceIds?.length || !body?.startsAt || !body?.deviceId) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  try {
    const result = createHold({
      shopId: body.shopId,
      serviceIds: body.serviceIds,
      staffId: body.staffId ?? null,
      startsAt: body.startsAt,
      deviceId: body.deviceId,
      guestName: body.guestName ?? 'Guest',
      idempotencyKey,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof SlotTaken) {
      // Same contract as the real API: the seat is gone, here are six others.
      return NextResponse.json(
        { error: 'slot_taken', alternatives: e.alternatives },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
