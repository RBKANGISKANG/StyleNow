import { NextRequest, NextResponse } from 'next/server';
import { adjustStock, deleteStockItem, saveStockItem, stockItems } from '@/core/store';
import { badRequest, fail, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ items: stockItems(params.id) });
}

/** Save (create or replace) an item. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const it = body.item;
  if (
    !it ||
    !isStr(it.name) ||
    !num(it.level) ||
    !num(it.reorderAt) ||
    (it.id != null && !isStr(it.id)) ||
    (it.perColourUse != null && !num(it.perColourUse))
  ) {
    return badRequest();
  }
  try {
    const item = saveStockItem(params.id, {
      id: it.id ?? undefined,
      name: it.name,
      level: it.level,
      reorderAt: it.reorderAt,
      perColourUse: it.perColourUse ?? undefined,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

/** Adjust { itemId } by { delta }. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (!isStr(body.itemId) || !num(body.delta)) return badRequest();
  try {
    adjustStock(params.id, body.itemId, body.delta);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const itemId = req.nextUrl.searchParams.get('itemId');
  if (!itemId) return badRequest();
  deleteStockItem(params.id, itemId);
  return NextResponse.json({ ok: true });
}
