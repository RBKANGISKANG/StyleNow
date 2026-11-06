import { NextRequest, NextResponse } from 'next/server';
import { retailItems, saveRetailItem } from '@/core/store';

export const dynamic = 'force-dynamic';

/**
 * The shelf, priced for the till. This lived only in the browser's own store
 * until now — syncConfig no-ops outside Supabase mode, so on a plain server
 * deployment the shelf a shop saved on one tablet never reached the process
 * that actually prices a sale (addRetail runs against this same server-side
 * list), and a second tablet could never see it either.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ items: retailItems(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  try {
    const item = saveRetailItem(params.id, {
      id: typeof body.id === 'string' ? body.id : undefined,
      name: String(body.name ?? ''),
      priceCents: Number(body.priceCents),
      stockItemId: typeof body.stockItemId === 'string' ? body.stockItemId : undefined,
    });
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
