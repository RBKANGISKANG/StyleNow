import { NextRequest, NextResponse } from 'next/server';
import { patchLocation, deleteLocation } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; lid: string } }) {
  const body = await req.json().catch(() => ({}));
  patchLocation(params.id, params.lid, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; lid: string } }) {
  try {
    deleteLocation(params.id, params.lid);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
