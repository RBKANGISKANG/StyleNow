import { NextRequest, NextResponse } from 'next/server';
import { addRetail, removeRetail } from '@/core/store';

export const dynamic = 'force-dynamic';

/** Sell a shelf product onto a visit — see store.addRetail. */
export async function POST(req: NextRequest, { params }: { params: { id: string; bid: string } }) {
  const body = await req.json().catch(() => ({}));
  const itemId = typeof body.itemId === 'string' ? body.itemId : '';
  const qty = Number.isInteger(body.qty) ? body.qty : 1;
  if (!itemId) return NextResponse.json({ error: 'missing_item' }, { status: 400 });
  try {
    const b = addRetail(params.id, params.bid, itemId, qty);
    return NextResponse.json({ totalCents: b.quote.totalCents, retail: b.retail ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** Undo a sale — see store.removeRetail. ?index=N, the line's position. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string; bid: string } }) {
  const index = Number(req.nextUrl.searchParams.get('index'));
  if (!Number.isInteger(index) || index < 0) return NextResponse.json({ error: 'bad_index' }, { status: 400 });
  try {
    const b = removeRetail(params.id, params.bid, index);
    return NextResponse.json({ totalCents: b.quote.totalCents, retail: b.retail ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
