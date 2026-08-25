import { NextRequest, NextResponse } from 'next/server';
import { addStaff, effectiveStaff } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ staff: effectiveStaff(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body?.name?.trim()) return NextResponse.json({ error: 'missing_name' }, { status: 400 });
  return NextResponse.json({ member: addStaff(params.id, body) }, { status: 201 });
}
