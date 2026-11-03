import { NextRequest, NextResponse } from 'next/server';
import { myStampCards } from '@/core/store';
import { badRequest, isDevice } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!isDevice(deviceId)) return badRequest();
  return NextResponse.json({ cards: myStampCards(deviceId) });
}
