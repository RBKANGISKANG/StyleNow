import { NextRequest, NextResponse } from 'next/server';
import { nextOpenings } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const q = req.nextUrl.searchParams;
  const serviceIds = (q.get('serviceIds') ?? '').split(',').filter(Boolean);
  if (serviceIds.length === 0) return NextResponse.json({ error: 'service_required' }, { status: 400 });
  const limit = Number(q.get('limit') ?? 6);
  return NextResponse.json({
    openings: nextOpenings(params.id, serviceIds, q.get('deviceId') ?? '', { limit }),
  });
}
