import { NextRequest, NextResponse } from 'next/server';
import { customersForShop, setCustomerNote } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ customers: customersForShop(params.id) });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (typeof body?.key !== 'string') return NextResponse.json({ error: 'missing_key' }, { status: 400 });
  setCustomerNote(params.id, body.key, String(body.note ?? ''));
  return NextResponse.json({ ok: true });
}
