import { NextRequest, NextResponse } from 'next/server';
import { leaveWaitlist, waitlistEntry } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const entry = waitlistEntry(params.id);
  // Already gone: leaving is idempotent.
  if (!entry) return NextResponse.json({ ok: true });
  if (entry.deviceId !== deviceId) return NextResponse.json({ error: 'not_yours' }, { status: 403 });
  leaveWaitlist(params.id);
  return NextResponse.json({ ok: true });
}
