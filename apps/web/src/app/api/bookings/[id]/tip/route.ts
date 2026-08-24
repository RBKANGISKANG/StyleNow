import { NextRequest, NextResponse } from 'next/server';
import { setTip } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.tipCents !== 'number' || body.tipCents < 0) {
    return NextResponse.json({ error: 'invalid_tip' }, { status: 400 });
  }
  try {
    const b = setTip(params.id, body.tipCents);
    return NextResponse.json({ tipCents: b.tipCents });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
