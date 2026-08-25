import { NextRequest, NextResponse } from 'next/server';
import { addAbsence, absencesFor } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { sid: string } }) {
  return NextResponse.json({ absences: absencesFor(params.sid) });
}

export async function POST(req: NextRequest, { params }: { params: { sid: string } }) {
  const body = await req.json().catch(() => null);
  if (!body?.from || !body?.to) return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  return NextResponse.json({ absence: addAbsence(params.sid, body) }, { status: 201 });
}
