import { NextRequest, NextResponse } from 'next/server';
import { arrivalNoteOf, consentTextOf, payAtSalonOf } from '@/core/store';

export const dynamic = 'force-dynamic';

/**
 * The owner's own copy of the wording — split out from the public policies
 * GET on purpose. That route is unauthenticated and answers every caller,
 * customer and stranger alike; a door code belongs behind a request only the
 * dashboard makes, not sitting in the same JSON body as the gated, per-device
 * field. This demo has no real auth layer to check against (every owner-only
 * write in this app shares that limitation), but at minimum the read should
 * not be reachable from the URL the public booking flow already calls.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({
    arrivalNoteOwn: arrivalNoteOf(params.id),
    consentText: consentTextOf(params.id),
    payAtSalon: payAtSalonOf(params.id),
  });
}
