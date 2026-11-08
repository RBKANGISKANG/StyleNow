import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { setStampSettings, stampStatus } from '@/core/store';
import { badRequest, isDevice } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** This device's Stempelkarte at the shop. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!isDevice(deviceId)) return badRequest();
  return NextResponse.json({ status: stampStatus(params.id, deviceId) });
}

/** { enabled, required } — the salon's card settings. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== 'boolean' || typeof body.required !== 'number' || !Number.isFinite(body.required)) {
    return badRequest();
  }
  setStampSettings(params.id, { enabled: body.enabled, required: body.required });
  return NextResponse.json({ ok: true });
}
