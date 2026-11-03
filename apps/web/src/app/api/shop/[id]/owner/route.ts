import { NextRequest, NextResponse } from 'next/server';
import { claimShop, releaseShop } from '@/core/store';
import { badRequest, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (!isStr(body.ownerKey) || !body.ownerKey) return badRequest();
  claimShop(params.id, body.ownerKey);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  releaseShop(params.id);
  return NextResponse.json({ ok: true });
}
