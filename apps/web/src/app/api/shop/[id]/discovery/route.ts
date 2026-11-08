import { NextRequest, NextResponse } from 'next/server';
import { alternativesFor, cheapestSlots, staffInsights, suggestedAddOns } from '@/core/store';
import { badRequest, fail, isDevice, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/**
 * Booking-flow helpers that read live availability: { view, serviceIds,
 * deviceId, isoDate? } → { data }. POST because serviceIds is a list.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const body = await req.json().catch(() => ({}));
  const ids = body.serviceIds;
  if (!Array.isArray(ids) || !ids.every(isStr) || ids.length > 20) return badRequest();
  const id = params.id;
  try {
    switch (body.view) {
      case 'add-ons':
        return NextResponse.json({ data: suggestedAddOns(id, ids) });
      case 'cheapest':
        if (!isDevice(body.deviceId)) return badRequest();
        return NextResponse.json({ data: cheapestSlots(id, ids, body.deviceId) });
      case 'insights':
        if (!isDevice(body.deviceId)) return badRequest();
        return NextResponse.json({ data: staffInsights(id, ids, body.deviceId) });
      case 'alternatives':
        if (!isDevice(body.deviceId) || !isStr(body.isoDate)) return badRequest();
        return NextResponse.json({ data: alternativesFor(id, ids, body.isoDate, body.deviceId) });
      default:
        return badRequest();
    }
  } catch (e) {
    return fail(e);
  }
}
