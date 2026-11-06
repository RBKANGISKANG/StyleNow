import { NextRequest, NextResponse } from 'next/server';
import { staffWeek } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const staffId = req.nextUrl.searchParams.get('staffId') ?? '';
  const from = req.nextUrl.searchParams.get('from') ?? '';
  if (!staffId || !from) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  return NextResponse.json({ days: staffWeek(params.id, staffId, from) });
}
