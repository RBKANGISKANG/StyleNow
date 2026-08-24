import { NextRequest, NextResponse } from 'next/server';
import { leaveWaitlist } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  leaveWaitlist(params.id);
  return NextResponse.json({ ok: true });
}
