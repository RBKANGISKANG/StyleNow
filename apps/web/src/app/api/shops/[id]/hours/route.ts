import { NextRequest, NextResponse } from 'next/server';
import { openingHours, shopStatus, shopClosures, primeWindowsFor } from '@/core/store';
import { todayIso } from '@/core/time';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const today = todayIso();
  // ?prime=<iso date> asks only for that day's Prime-bookable windows.
  const primeIso = req.nextUrl.searchParams.get('prime');
  if (primeIso) return NextResponse.json({ primeWindows: primeWindowsFor(params.id, primeIso) });
  return NextResponse.json({
    days: openingHours(params.id),
    status: shopStatus(params.id),
    // Only closures still ahead — a customer does not care that the shop was
    // shut last Easter.
    closures: shopClosures(params.id).filter((c) => c.to >= today),
  });
}
