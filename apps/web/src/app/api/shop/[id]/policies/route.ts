import { NextRequest, NextResponse } from 'next/server';
import { consentTextOf, consentRequired, setConsentText, arrivalNoteOf, arrivalNoteFor, setArrivalNote } from '@/core/store';

export const dynamic = 'force-dynamic';

/**
 * The two bits of wording a shop owns: the consent a flagged treatment needs,
 * and how to actually find the door. The arrival note is only handed to a
 * device that holds a live booking — a door code is not public information.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const p = req.nextUrl.searchParams;
  const deviceId = p.get('deviceId') ?? '';
  const serviceIds = (p.get('serviceIds') ?? '').split(',').filter(Boolean);
  return NextResponse.json({
    consentText: consentTextOf(params.id),
    consentRequired: serviceIds.length ? consentRequired(params.id, serviceIds) : '',
    arrivalNote: deviceId ? arrivalNoteFor(params.id, deviceId) : '',
    arrivalNoteOwn: arrivalNoteOf(params.id),
  });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.consentText === 'string') setConsentText(params.id, body.consentText);
  if (typeof body.arrivalNote === 'string') setArrivalNote(params.id, body.arrivalNote);
  return NextResponse.json({ consentText: consentTextOf(params.id), arrivalNoteOwn: arrivalNoteOf(params.id) });
}
