import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { latestTechRecord, setTechRecord } from '@/core/store';
import { badRequest, fail, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** The newest formula card for ?customerKey= at this shop, or null. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const customerKey = req.nextUrl.searchParams.get('customerKey');
  if (!customerKey) return badRequest();
  return NextResponse.json({ latest: latestTechRecord(params.id, customerKey) });
}

/** Write the card on { bookingId }: { formula, developer?, processingMin?, note?, byStaffId }. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const r = body.record;
  if (
    !isStr(body.bookingId) ||
    !r ||
    !isStr(r.formula) ||
    !isStr(r.byStaffId) ||
    (r.developer != null && !isStr(r.developer)) ||
    (r.note != null && !isStr(r.note)) ||
    (r.processingMin != null && typeof r.processingMin !== 'number')
  ) {
    return badRequest();
  }
  try {
    setTechRecord(params.id, body.bookingId, {
      formula: r.formula,
      developer: r.developer ?? undefined,
      processingMin: r.processingMin ?? undefined,
      note: r.note ?? undefined,
      byStaffId: r.byStaffId,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
