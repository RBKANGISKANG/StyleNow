import { NextRequest, NextResponse } from 'next/server';
import { isShopOwner, noticesForDevice, noticesForShop, shopsForOwner } from '@/core/store';
import { callerKeys } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId') ?? '';
  // Ownership is claimed in the caller's browser store, so the client sends
  // its shop ids explicitly; `owner` remains as a fallback for old callers.
  const shopsParam = req.nextUrl.searchParams.get('shops');
  const owner = req.nextUrl.searchParams.get('owner');
  const shopIds = shopsParam
    ? shopsParam.split(',').filter(Boolean)
    : owner
      ? shopsForOwner(owner)
      : [];
  const own = deviceId ? noticesForDevice(deviceId) : [];
  // Only salons the caller can prove it runs.
  const keys = callerKeys(req);
  const forShops = shopIds.filter((id) => keys.some((k) => isShopOwner(id, k))).flatMap((id) => noticesForShop(id));
  return NextResponse.json({ notices: [...own, ...forShops].sort((a, b) => b.at - a.at) });
}
