import { NextRequest, NextResponse } from 'next/server';
import { deleteAbsence } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { sid: string; aid: string } }) {
  deleteAbsence(params.sid, params.aid);
  return NextResponse.json({ ok: true });
}
