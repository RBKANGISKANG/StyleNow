import { NextRequest, NextResponse } from 'next/server';
import { joinWaitlist, waitlistForDevice } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.deviceId || !body?.shopId || !body?.serviceIds?.length || !body?.isoDate) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  return NextResponse.json({ entry: joinWaitlist(body.deviceId, body.shopId, body.serviceIds, body.isoDate) }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json({ error: 'missing_device' }, { status: 400 });
  return NextResponse.json({ entries: waitlistForDevice(deviceId) });
}
