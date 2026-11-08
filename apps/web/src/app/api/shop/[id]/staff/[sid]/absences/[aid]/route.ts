import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { deleteAbsence } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string; sid: string; aid: string }> }
) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  deleteAbsence(params.sid, params.aid);
  return NextResponse.json({ ok: true });
}
