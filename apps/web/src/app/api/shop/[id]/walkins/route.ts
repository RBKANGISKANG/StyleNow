import { NextRequest, NextResponse } from 'next/server';
import { addWalkIn, walkIns } from '@/core/store';
import { errStatus } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ walkIns: walkIns(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.name !== 'string' || !Array.isArray(body.serviceIds) || !body.serviceIds.every((s: unknown) => typeof s === 'string')) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    return NextResponse.json({ entry: addWalkIn(params.id, body.name, body.serviceIds) }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
