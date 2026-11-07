import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { addCashEntry, cashEntries, deleteCashEntry, drawerReport } from '@/core/store';
import { badRequest, fail, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The day's Kassenbuch entries and drawer report for ?iso=. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const iso = req.nextUrl.searchParams.get('iso');
  if (!iso || !ISO.test(iso)) return badRequest();
  return NextResponse.json({ entries: cashEntries(params.id, iso), report: drawerReport(params.id, iso) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (!isStr(body.iso) || !ISO.test(body.iso) || !isStr(body.kind) || typeof body.amountCents !== 'number') return badRequest();
  if (body.note != null && !isStr(body.note)) return badRequest();
  try {
    const entry = addCashEntry(params.id, body.iso, { kind: body.kind, amountCents: body.amountCents, note: body.note ?? undefined });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const iso = req.nextUrl.searchParams.get('iso');
  const entryId = req.nextUrl.searchParams.get('entryId');
  if (!iso || !ISO.test(iso) || !entryId) return badRequest();
  deleteCashEntry(params.id, iso, entryId);
  return NextResponse.json({ ok: true });
}
