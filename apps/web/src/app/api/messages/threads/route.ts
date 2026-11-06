import { NextRequest, NextResponse } from 'next/server';
import { shopThreads, threadsForDevice, unreadForShop, unreadForDevice } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId');
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  // ?count=1 asks for the badge number only — no need to build every row.
  const countOnly = req.nextUrl.searchParams.get('count') === '1';
  if (shopId) {
    return NextResponse.json(countOnly ? { unread: unreadForShop(shopId) } : { threads: shopThreads(shopId) });
  }
  if (deviceId) {
    return NextResponse.json(countOnly ? { unread: unreadForDevice(deviceId) } : { threads: threadsForDevice(deviceId) });
  }
  return NextResponse.json({ threads: [] });
}
