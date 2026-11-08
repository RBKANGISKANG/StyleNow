import { NextRequest, NextResponse } from 'next/server';
import { salonReferralStats, shopById } from '@/core/store';
import { requireShopAccess } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** The salon's invite code and what it has earned — owner only. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!shopById(params.id)) return NextResponse.json({ error: 'shop_not_found' }, { status: 404 });
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  return NextResponse.json(salonReferralStats(params.id));
}
