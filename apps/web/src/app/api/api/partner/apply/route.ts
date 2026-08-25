import { NextRequest, NextResponse } from 'next/server';
import { submitShopApplication, applicationsForDevice } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.deviceId || !body?.data) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  return NextResponse.json({ application: submitShopApplication(body.deviceId, body.data) }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json({ error: 'missing_device' }, { status: 400 });
  return NextResponse.json({ applications: applicationsForDevice(deviceId) });
}
