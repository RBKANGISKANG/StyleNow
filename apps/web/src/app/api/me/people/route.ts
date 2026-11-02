import { NextRequest, NextResponse } from 'next/server';
import { addPerson, removePerson, savedPeople } from '@/core/store';
import { badRequest, fail, isDevice, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** Saved people are keyed by the device: every action names it, and only ever touches that device's list. */
export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json({ error: 'missing_device' }, { status: 400 });
  return NextResponse.json({ people: savedPeople(deviceId) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!isDevice(body.deviceId) || !isStr(body.name)) return badRequest();
  if ((body.emoji != null && !isStr(body.emoji)) || (body.note != null && !isStr(body.note))) return badRequest();
  try {
    const person = addPerson(body.deviceId, { name: body.name, emoji: body.emoji ?? undefined, note: body.note ?? undefined });
    return NextResponse.json({ person }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  const personId = req.nextUrl.searchParams.get('personId');
  if (!deviceId || !personId) return badRequest();
  removePerson(deviceId, personId);
  return NextResponse.json({ ok: true });
}
