import { NextRequest, NextResponse } from 'next/server';
import { openingHours, shopStatus, shopClosures } from '@/core/store';
import { todayIso } from '@/core/time';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const today = todayIso();
  return NextResponse.json({
    days: openingHours(params.id),
    status: shopStatus(params.id),
    // Only closures still ahead — a customer does not care that the shop was
    // shut last Easter.
    closures: shopClosures(params.id).filter((c) => c.to >= today),
  });
}
