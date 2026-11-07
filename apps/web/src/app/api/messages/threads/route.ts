import { NextRequest, NextResponse } from 'next/server';
import { requireShopAccess } from '@/app/api/_lib/guards';
import { callerKeys } from '@/lib/session';
import { shopThreads, threadsForDevice, unreadForShop, unreadForDevice } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId');
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  // ?count=1 asks for the badge number only — no need to build every row.
  const countOnly = req.nextUrl.searchParams.get('count') === '1';
  if (shopId) {
    const denied = requireShopAccess(req, shopId);
    if (denied) return denied;
    return NextResponse.json(countOnly ? { unread: unreadForShop(shopId) } : { threads: shopThreads(shopId) });
  }
  if (deviceId) {
    if (!callerKeys(req).includes(deviceId)) return NextResponse.json({ error: 'not_yours' }, { status: 403 });
    return NextResponse.json(countOnly ? { unread: unreadForDevice(deviceId) } : { threads: threadsForDevice(deviceId) });
  }
  return NextResponse.json({ threads: [] });
}
