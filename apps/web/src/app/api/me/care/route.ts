import { NextRequest, NextResponse } from 'next/server';
import {
  careProfile,
  patchTestValid,
  recordPatchTest,
  setAccessNeeds,
  setAllergies,
  setBirthday,
} from '@/core/store';
import { badRequest, fail, isDevice, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/**
 * The care profile (allergies, patch tests, birthday, access needs) is keyed by
 * the device; every action names it and reads or writes that profile only.
 * GET ?shopId= also answers whether the patch test for that shop is valid.
 */
export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json({ error: 'missing_device' }, { status: 400 });
  const shopId = req.nextUrl.searchParams.get('shopId');
  return NextResponse.json({
    profile: careProfile(deviceId),
    ...(shopId ? { patchTestValid: patchTestValid(deviceId, shopId) } : {}),
  });
}

/** Record a patch test at { shopId }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isDevice(body.deviceId) || !isStr(body.shopId)) return badRequest();
  try {
    recordPatchTest(body.deviceId, body.shopId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

/** Set any of { allergies, birthday, access } — a key that is present is written. */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isDevice(body.deviceId)) return badRequest();
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (has('allergies') && !(Array.isArray(body.allergies) && body.allergies.every(isStr))) return badRequest();
  if (has('birthday') && body.birthday !== null && !isStr(body.birthday)) return badRequest();
  if (has('access') && body.access !== null && (typeof body.access !== 'object' || Array.isArray(body.access))) return badRequest();
  if (has('access') && body.access?.note != null && !isStr(body.access.note)) return badRequest();
  try {
    if (has('allergies')) setAllergies(body.deviceId, body.allergies);
    if (has('birthday')) setBirthday(body.deviceId, body.birthday);
    if (has('access')) setAccessNeeds(body.deviceId, body.access);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
