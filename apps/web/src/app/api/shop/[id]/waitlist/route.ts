import { NextRequest, NextResponse } from 'next/server';
import { waitlistForShop } from '@/core/store';
import { todayIso } from '@/core/time';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const from = req.nextUrl.searchParams.get('from') ?? todayIso();
  return NextResponse.json({ waiting: waitlistForShop(params.id, from) });
}
