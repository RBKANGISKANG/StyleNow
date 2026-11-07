import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { addAbsence, absencesFor, requestAbsence, approveAbsence } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  return NextResponse.json({ absences: absencesFor(params.sid) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body?.from || !body?.to) return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  const { asRequest, ...input } = body;
  // asRequest is the employee's door: same list, but pending until approved.
  const absence = asRequest ? requestAbsence(params.sid, input) : addAbsence(params.sid, input);
  return NextResponse.json({ absence }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; sid: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (typeof body?.absenceId !== 'string') return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  approveAbsence(params.sid, body.absenceId);
  return NextResponse.json({ ok: true });
}
