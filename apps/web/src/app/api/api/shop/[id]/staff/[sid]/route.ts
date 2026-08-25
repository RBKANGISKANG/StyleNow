import { NextRequest, NextResponse } from 'next/server';
import { patchStaff, archiveStaff } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  const body = await req.json().catch(() => ({}));
  try {
    patchStaff(params.id, params.sid, body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  try {
    archiveStaff(params.id, params.sid);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // "last_staff" is a rule, not a missing resource
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
