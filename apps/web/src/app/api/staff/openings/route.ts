import { NextRequest, NextResponse } from 'next/server';
import { followedOpeningsFor } from '@/core/store';

export const dynamic = 'force-dynamic';

/**
 * Next open slot for each followed stylist — computed here because only the
 * server process holds real bookings in server mode. `followedStaff` itself
 * stays a browser-local preference (nothing about it needs the pricing
 * engine), so the caller resolves that list locally and sends it along.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const staffIds = Array.isArray(body.staffIds) ? body.staffIds.filter((s: unknown) => typeof s === 'string') : [];
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  return NextResponse.json({ rows: followedOpeningsFor(staffIds, deviceId) });
}
