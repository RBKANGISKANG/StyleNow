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
      consentName: typeof body.consentName === 'string' ? body.consentName : undefined,
    });
    return NextResponse.json({ id: b.id, reference: b.reference, status: b.status }, { status: 201 });
  } catch (e) {
    if (e instanceof SlotTaken) {
      return NextResponse.json({ error: 'slot_taken', alternatives: e.alternatives }, { status: 409 });
    }
    const message = (e as Error).message;
    // consent_required is a real refusal the front desk needs to see and act
    // on (collect the name), not a generic 404 — the two were indistinguishable
    // to the caller before, and the UI showed "this time was just taken" for both.
    return NextResponse.json({ error: message }, { status: message === 'consent_required' ? 400 : 404 });
  }
}
