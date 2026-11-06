import { NextRequest, NextResponse } from 'next/server';
import { joinMembership, leaveMembership, myMembership } from '@/core/store';
import { errStatus } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  return NextResponse.json({ membership: myMembership(deviceId, params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.deviceId !== 'string' || !body.deviceId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    return NextResponse.json({ membership: joinMembership(body.deviceId, params.id) }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  leaveMembership(deviceId, params.id);
  return NextResponse.json({ ok: true });
}
