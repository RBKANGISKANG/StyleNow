import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { addStaff, effectiveStaff } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  return NextResponse.json({ staff: effectiveStaff(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body?.name?.trim()) return NextResponse.json({ error: 'missing_name' }, { status: 400 });
  return NextResponse.json({ member: addStaff(params.id, body) }, { status: 201 });
}
