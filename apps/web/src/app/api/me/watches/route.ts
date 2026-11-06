import { NextRequest, NextResponse } from 'next/server';
import { addAvailabilityWatch, myWatches, removeAvailabilityWatch } from '@/core/store';
import { badRequest, fail, isDevice, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** Availability watches: the engine only lists or removes the given device's own watches. */
export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json({ error: 'missing_device' }, { status: 400 });
  return NextResponse.json({ watches: myWatches(deviceId) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isDevice(body.deviceId) || !isStr(body.shopId) || !isStr(body.serviceId)) return badRequest();
  const staffId = body.staffId ?? null;
  const dow = body.dow ?? null;
  if ((staffId !== null && !isStr(staffId)) || (dow !== null && !Number.isInteger(dow))) return badRequest();
  try {
    const watch = addAvailabilityWatch(body.deviceId, body.shopId, body.serviceId, staffId, dow);
    return NextResponse.json({ watch }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  const watchId = req.nextUrl.searchParams.get('watchId');
  if (!deviceId || !watchId) return badRequest();
  removeAvailabilityWatch(deviceId, watchId);
  return NextResponse.json({ ok: true });
}
