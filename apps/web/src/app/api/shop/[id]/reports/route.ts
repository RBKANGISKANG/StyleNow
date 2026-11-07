import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import {
  bookingLedger,
  colourServicesThisWeek,
  dayDriftMin,
  dayLoadForecast,
  dayLoadRange,
  effectiveStaff,
  gapWindows,
  leaveBy,
  quietWindows,
  reviewTagStats,
  shopTrust,
  staffEarningsReport,
  TRAVEL_SPEEDS_KMH,
  utilizationReport,
  type TravelMode,
} from '@/core/store';
import { badRequest, fail } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read-only views derived from the shop's bookings and configuration, picked
 * with ?view=. Every answer is { data } so the wrappers unwrap one key.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const q = req.nextUrl.searchParams;
  const id = params.id;
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';
  const range = () => ISO.test(from) && ISO.test(to);
  try {
    // Shop-private views (money, staff pay, utilisation) need the owner.
    if (['ledger', 'staff-earnings', 'utilization', 'colour-week', 'gaps'].includes(q.get('view') ?? '')) {
      const denied = requireShopAccess(req, id);
      if (denied) return denied;
    }
    switch (q.get('view')) {
      case 'forecast':
        return NextResponse.json({ data: dayLoadForecast(id) });
      case 'load-range': {
        const count = Number(q.get('count'));
        if (!ISO.test(from) || !Number.isInteger(count) || count < 0 || count > 400) return badRequest();
        return NextResponse.json({ data: dayLoadRange(id, from, count) });
      }
      case 'trust':
        return NextResponse.json({ data: shopTrust(id) });
      case 'quiet-windows':
        return NextResponse.json({ data: quietWindows(id) });
      case 'gaps': {
        const iso = q.get('iso') ?? '';
        if (!ISO.test(iso)) return badRequest();
        return NextResponse.json({ data: gapWindows(id, iso) });
      }
      case 'drift':
        return NextResponse.json({ data: dayDriftMin(id) });
      case 'colour-week':
        return NextResponse.json({ data: colourServicesThisWeek(id) });
      case 'review-tags':
        return NextResponse.json({ data: reviewTagStats(id) });
      case 'ledger':
        if (!range()) return badRequest();
        return NextResponse.json({ data: bookingLedger(id, from, to) });
      case 'staff-earnings':
        if (!range()) return badRequest();
        return NextResponse.json({ data: staffEarningsReport(id, from, to) });
      case 'utilization':
        if (!range()) return badRequest();
        return NextResponse.json({ data: utilizationReport(id, from, to) });
      case 'staff-meta': {
        const staffId = q.get('staffId');
        if (!staffId) return badRequest();
        return NextResponse.json({ data: effectiveStaff(id).find((s) => s.id === staffId)?.languages ?? [] });
      }
      case 'leave-by': {
        const startsAt = Number(q.get('startsAt'));
        const mode = q.get('mode') as TravelMode;
        if (!Number.isFinite(startsAt) || !Object.prototype.hasOwnProperty.call(TRAVEL_SPEEDS_KMH, mode)) return badRequest();
        return NextResponse.json({ data: leaveBy(id, startsAt, mode) });
      }
      default:
        return badRequest();
    }
  } catch (e) {
    return fail(e);
  }
}
