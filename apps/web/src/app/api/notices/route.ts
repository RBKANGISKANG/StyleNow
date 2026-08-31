import { NextRequest, NextResponse } from 'next/server';
import { noticesForDevice, noticesForShop, shopsForOwner } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId') ?? '';
  const owner = req.nextUrl.searchParams.get('owner');
  const own = deviceId ? noticesForDevice(deviceId) : [];
  const forShops = owner ? shopsForOwner(owner).flatMap((id) => noticesForShop(id)) : [];
  return NextResponse.json({ notices: [...own, ...forShops].sort((a, b) => b.at - a.at) });
}
