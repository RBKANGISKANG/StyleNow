import { NextRequest, NextResponse } from 'next/server';
import { hrOverview } from '@/core/store';
import { todayIso, addDays } from '@/core/time';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const from = req.nextUrl.searchParams.get('from') ?? todayIso();
  const to = req.nextUrl.searchParams.get('to') ?? addDays(from, 30);
  return NextResponse.json({ rows: hrOverview(params.id, from, to) });
}
