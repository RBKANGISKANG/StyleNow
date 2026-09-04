import { NextRequest, NextResponse } from 'next/server';
import { createDuoHold, SlotTaken } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const key = req.headers.get('idempotency-key');
  if (!body || !key || typeof body.deviceId !== 'string') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    const pair = createDuoHold(
      {
        shopId: body.shopId,
        serviceIds: body.serviceIds,
        staffId: body.staffId ?? null,
        startsAt: body.startsAt,
        deviceId: body.deviceId,
        guestName: body.guestName,
        guestPhone: body.guestPhone,
        guestNote: body.guestNote,
        voucherCode: body.voucherCode,
        pointsToSpend: body.pointsToSpend,
        idempotencyKey: key,
      },
      typeof body.friendName === 'string' ? body.friendName : '',
    );
    return NextResponse.json(pair);
  } catch (e) {
    if (e instanceof SlotTaken) {
      return NextResponse.json({ error: 'slot_taken', alternatives: e.alternatives }, { status: 409 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
