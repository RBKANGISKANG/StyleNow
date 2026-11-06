import { NextRequest, NextResponse } from 'next/server';
import { rosterCalendar } from '@/core/store';
import { todayIso, addDays } from '@/core/time';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const q = req.nextUrl.searchParams;
  const from = q.get('from') ?? todayIso();
  const to = q.get('to') ?? addDays(from, 13);
  if (to < from) return NextResponse.json({ error: 'range_reversed' }, { status: 400 });
  return NextResponse.json(rosterCalendar(params.id, from, to));
}
