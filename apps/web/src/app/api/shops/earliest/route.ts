import { NextRequest, NextResponse } from 'next/server';
import { earliestAcross } from '@/core/store';

export const dynamic = 'force-dynamic';

/** Soonest bookable time across a set of favourite shops — real availability. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const shopIds = Array.isArray(body.shopIds) ? body.shopIds.filter((s: unknown) => typeof s === 'string') : [];
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  return NextResponse.json({ rows: earliestAcross(shopIds, deviceId) });
}
