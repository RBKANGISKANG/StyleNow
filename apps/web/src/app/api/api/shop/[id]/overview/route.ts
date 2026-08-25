import { NextRequest, NextResponse } from 'next/server';
import { dashboardOverview } from '@/core/store';
import { todayIso } from '@/core/time';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const date = req.nextUrl.searchParams.get('date') ?? todayIso();
  try {
    return NextResponse.json(dashboardOverview(params.id, date));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
