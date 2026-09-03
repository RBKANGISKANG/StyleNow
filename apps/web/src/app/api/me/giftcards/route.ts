import { NextRequest, NextResponse } from 'next/server';
import { giftCardsForDevice } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId') ?? '';
  return NextResponse.json({ cards: deviceId ? giftCardsForDevice(deviceId) : [] });
}
