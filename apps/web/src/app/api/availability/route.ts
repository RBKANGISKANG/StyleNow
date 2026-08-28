import { NextRequest, NextResponse } from 'next/server';
import { availability } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const shopId = p.get('shopId');
  const serviceIds = (p.get('serviceIds') ?? '').split(',').filter(Boolean);
  const date = p.get('date');
  const staffId = p.get('staffId');
  const deviceId = p.get('deviceId') ?? 'anonymous';
  if (!shopId || serviceIds.length === 0 || !date) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  try {
    const backfill = p.get('backfill') === '1';
    return NextResponse.json(availability(shopId, serviceIds, date, deviceId, staffId, { backfill }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
