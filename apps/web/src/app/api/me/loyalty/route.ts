import { NextRequest, NextResponse } from 'next/server';
import { loyaltyBalance } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json({ error: 'missing_device' }, { status: 400 });
  return NextResponse.json({ points: loyaltyBalance(deviceId) });
}
