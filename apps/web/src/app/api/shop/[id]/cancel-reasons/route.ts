import { NextRequest, NextResponse } from 'next/server';
import { cancelReasonStats } from '@/core/store';

export const dynamic = 'force-dynamic';

/**
 * Why people cancel, counted from real bookings. cancelReasonStats reads
 * state.bookings directly — in server mode that is only ever the server
 * process's own copy, since cancellations go through /api/bookings/[id]/cancel
 * and land there, never in the browser's seed-only mirror.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ rows: cancelReasonStats(params.id) });
}
