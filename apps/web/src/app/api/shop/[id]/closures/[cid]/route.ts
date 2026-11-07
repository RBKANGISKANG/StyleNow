import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { deleteClosure } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: { id: string; cid: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  deleteClosure(params.id, params.cid);
  return NextResponse.json({ ok: true });
}
