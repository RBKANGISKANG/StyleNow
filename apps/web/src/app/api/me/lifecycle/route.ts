import { NextRequest, NextResponse } from 'next/server';
import { customerRecap, eraseMyData, exportMyData, lastMinuteDeals, myReferralCode, rebookCadence } from '@/core/store';
import { badRequest, fail, isDevice } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** This device's derived views, picked with ?view= — answers are { data }. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const deviceId = q.get('deviceId');
  if (!isDevice(deviceId)) return badRequest();
  try {
    switch (q.get('view')) {
      case 'rebook':
        return NextResponse.json({ data: rebookCadence(deviceId) });
      case 'recap': {
        const year = Number(q.get('year'));
        if (!Number.isInteger(year)) return badRequest();
        return NextResponse.json({ data: customerRecap(deviceId, year) });
      }
      case 'export':
        return NextResponse.json({ data: exportMyData(deviceId) });
      case 'deals':
        return NextResponse.json({ data: lastMinuteDeals(deviceId) });
      default:
        return badRequest();
    }
  } catch (e) {
    return fail(e);
  }
}

/** Register (idempotently) and return this device's referral code. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isDevice(body.deviceId)) return badRequest();
  return NextResponse.json({ code: myReferralCode(body.deviceId) });
}

/** Erase this device's personal data from the server's engine. */
export async function DELETE(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!isDevice(deviceId)) return badRequest();
  return NextResponse.json({ erased: eraseMyData(deviceId) });
}
