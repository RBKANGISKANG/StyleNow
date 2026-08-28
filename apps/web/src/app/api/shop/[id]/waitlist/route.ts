import { NextRequest, NextResponse } from 'next/server';
import { waitlistForShop, offerWaitlistSlot } from '@/core/store';
import { todayIso } from '@/core/time';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const from = req.nextUrl.searchParams.get('from') ?? todayIso();
  return NextResponse.json({ waiting: waitlistForShop(params.id, from) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.entryId !== 'string' || typeof body.startsAt !== 'number') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    offerWaitlistSlot(params.id, body.entryId, body.startsAt);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === 'slot_gone' ? 409 : 404 });
  }
}
