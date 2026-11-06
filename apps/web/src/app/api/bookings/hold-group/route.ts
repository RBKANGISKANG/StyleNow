import { NextRequest, NextResponse } from 'next/server';
import { createGroupHold, SlotTaken } from '@/core/store';

export const dynamic = 'force-dynamic';

/**
 * Three or more seats, one act. Mirrors hold-duo — createGroupHold was
 * previously only ever called from the local/Supabase branch of apiGroupHold,
 * which meant every party booking silently ran against the browser's own
 * seed copy of the store in the default server deployment instead of the
 * server process that actually holds the seat.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const key = req.headers.get('idempotency-key');
  if (!body || !key || typeof body.deviceId !== 'string' || !Array.isArray(body.friendNames)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    const holds = createGroupHold(
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
        useStampReward: Boolean(body.useStampReward),
        usePackageId: typeof body.usePackageId === 'string' ? body.usePackageId : undefined,
        forPersonId: typeof body.forPersonId === 'string' ? body.forPersonId : undefined,
        forMinor: body.forMinor === true,
        guardianName: typeof body.guardianName === 'string' ? body.guardianName : undefined,
        occasion: typeof body.occasion === 'string' ? (body.occasion as never) : undefined,
        consentName: typeof body.consentName === 'string' ? body.consentName : undefined,
        idempotencyKey: key,
      },
      body.friendNames.filter((n: unknown): n is string => typeof n === 'string'),
    );
    return NextResponse.json({ holds });
  } catch (e) {
    if (e instanceof SlotTaken) {
      return NextResponse.json({ error: 'slot_taken', alternatives: e.alternatives }, { status: 409 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
