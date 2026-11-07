import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { ackLogEntry, addLogEntry, deleteLogEntry, logEntries } from '@/core/store';
import { badRequest, fail, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  return NextResponse.json({ entries: logEntries(params.id) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (!isStr(body.authorStaffId) || !isStr(body.text)) return badRequest();
  try {
    return NextResponse.json({ entry: addLogEntry(params.id, body.authorStaffId, body.text, !!body.pinned) }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

/** Acknowledge { entryId } as { staffId }. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (!isStr(body.entryId) || !isStr(body.staffId)) return badRequest();
  try {
    ackLogEntry(params.id, body.entryId, body.staffId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const entryId = req.nextUrl.searchParams.get('entryId');
  if (!entryId) return badRequest();
  deleteLogEntry(params.id, entryId);
  return NextResponse.json({ ok: true });
}
