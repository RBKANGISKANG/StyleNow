import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { customersForShop, setCustomerNote } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  return NextResponse.json({ customers: customersForShop(params.id) });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id, { staff: true });
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (typeof body?.key !== 'string') return NextResponse.json({ error: 'missing_key' }, { status: 400 });
  setCustomerNote(params.id, body.key, String(body.note ?? ''));
  return NextResponse.json({ ok: true });
}
