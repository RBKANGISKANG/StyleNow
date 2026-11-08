import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { bookingConflicts } from '@/core/store';

export const dynamic = 'force-dynamic';

/** Bookings a personnel decision (time off, archiving, closure) would strand. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  return NextResponse.json({
    conflicts: bookingConflicts(params.id, {
      staffId: q.get('staff'),
      fromIso: q.get('from') ?? undefined,
      toIso: q.get('to') ?? undefined,
    }),
  });
}
