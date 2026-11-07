import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { deleteRetailItem } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  deleteRetailItem(params.id, params.itemId);
  return NextResponse.json({ ok: true });
}
