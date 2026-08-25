import { NextRequest, NextResponse } from 'next/server';
import { deleteClosure } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; cid: string } }) {
  deleteClosure(params.id, params.cid);
  return NextResponse.json({ ok: true });
}
