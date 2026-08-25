import { NextRequest, NextResponse } from 'next/server';
import { createShopBooking, SlotTaken } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body?.serviceIds?.length || !body?.startsAt || !body?.guestName) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  try {
    const b = createShopBooking(params.id, body.serviceIds, body.staffId ?? null, body.startsAt, body.guestName, {
      phone: body.phone,
      note: body.note,
    });
    return NextResponse.json({ id: b.id, reference: b.reference, status: b.status }, { status: 201 });
  } catch (e) {
    if (e instanceof SlotTaken) {
      return NextResponse.json({ error: 'slot_taken', alternatives: e.alternatives }, { status: 409 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
