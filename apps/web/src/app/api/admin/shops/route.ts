import { NextRequest, NextResponse } from 'next/server';
import { platformOverview, setShopPaused, isShopPaused, shopById } from '@/core/store';
import { requireAdmin, badRequest, fail, isStr } from '../../_lib/guards';

export const dynamic = 'force-dynamic';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const from = req.nextUrl.searchParams.get('from') ?? '';
  const to = req.nextUrl.searchParams.get('to') ?? '';
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return badRequest();
  const { rows, totals } = platformOverview(from, to);
  // the public page link needs the slug, which only the server's store knows for new salons
  return NextResponse.json({ rows: rows.map((r) => ({ ...r, slug: shopById(r.shopId)?.slug ?? '' })), totals });
}

export async function PATCH(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body || !isStr(body.shopId) || typeof body.paused !== 'boolean') return badRequest();
  try {
    setShopPaused(body.shopId, body.paused);
    return NextResponse.json({ shopId: body.shopId, paused: isShopPaused(body.shopId) });
  } catch (e) {
    return fail(e);
  }
}
