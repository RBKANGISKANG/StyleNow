import { NextRequest, NextResponse } from 'next/server';
import { deleteRetailItem } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  deleteRetailItem(params.id, params.itemId);
  return NextResponse.json({ ok: true });
}
