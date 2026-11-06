import { NextRequest, NextResponse } from 'next/server';
import { noticesForDevice, noticesForShop, shopsForOwner } from '@/core/store';

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
  const forShops = shopIds.flatMap((id) => noticesForShop(id));
  return NextResponse.json({ notices: [...own, ...forShops].sort((a, b) => b.at - a.at) });
}
