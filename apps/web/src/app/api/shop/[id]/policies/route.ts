import { NextRequest, NextResponse } from 'next/server';
import { consentTextOf, consentRequired, setConsentText, arrivalNoteFor, setArrivalNote, payAtSalonOf, setPayAtSalon } from '@/core/store';

export const dynamic = 'force-dynamic';

/**
 * The two bits of wording a shop owns: the consent a flagged treatment needs,
 * and how to actually find the door. This route is unauthenticated and public
 * — the booking flow calls it with no proof of anything — so the door code
 * itself is deliberately NOT in this response. It is only handed to a device
 * that holds a live booking (arrivalNoteFor's own gate), and the owner's raw
 * copy lives behind the separate /owner route instead of riding along here.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const p = req.nextUrl.searchParams;
  const deviceId = p.get('deviceId') ?? '';
  const serviceIds = (p.get('serviceIds') ?? '').split(',').filter(Boolean);
  return NextResponse.json({
    consentText: consentTextOf(params.id),
    consentRequired: serviceIds.length ? consentRequired(params.id, serviceIds) : '',
    arrivalNote: deviceId ? arrivalNoteFor(params.id, deviceId) : '',
    payAtSalon: payAtSalonOf(params.id),
  });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.consentText === 'string') setConsentText(params.id, body.consentText);
  if (typeof body.arrivalNote === 'string') setArrivalNote(params.id, body.arrivalNote);
  if (typeof body.payAtSalon === 'boolean') setPayAtSalon(params.id, body.payAtSalon);
  return NextResponse.json({
    consentText: consentTextOf(params.id),
    payAtSalon: payAtSalonOf(params.id),
  });
}
