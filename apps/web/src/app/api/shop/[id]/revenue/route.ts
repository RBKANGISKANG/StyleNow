import { NextRequest, NextResponse } from 'next/server';
import { revenueReport, dayCloseReport } from '@/core/store';
import { todayIso, addDays } from '@/core/time';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const q = req.nextUrl.searchParams;
  // ?close=YYYY-MM-DD → the daily closing report instead of the range report
  const close = q.get('close');
  if (close) return NextResponse.json(dayCloseReport(params.id, close));
  const to = q.get('to') ?? todayIso();
  const from = q.get('from') ?? addDays(to, -6);
  if (from > to) return NextResponse.json({ error: 'range_reversed' }, { status: 400 });
  return NextResponse.json(revenueReport(params.id, from, to));
}
