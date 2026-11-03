import { NextRequest, NextResponse } from 'next/server';
import { consultDone, ensureConsultService } from '@/core/store';
import { badRequest, fail, isDevice } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** Has this device already had its consultation here? */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!isDevice(deviceId)) return badRequest();
  return NextResponse.json({ done: consultDone(deviceId, params.id) });
}

/** Make sure the free consultation service exists; returns it. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json({ service: ensureConsultService(params.id) });
  } catch (e) {
    return fail(e);
  }
}
