import { NextRequest, NextResponse } from 'next/server';
import { shopClosures, addClosure } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ closures: shopClosures(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body?.from || !body?.to) return NextResponse.json({ error: 'missing_dates' }, { status: 400 });
  const from = String(body.from);
  const to = String(body.to);
  return NextResponse.json(
    addClosure(params.id, { from, to: to < from ? from : to, reason: String(body.reason ?? '') }),
    { status: 201 },
  );
}
