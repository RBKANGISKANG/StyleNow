import { NextRequest, NextResponse } from 'next/server';
import { allLeads, deleteLead, importLeads, updateLead, type LeadStatus } from '@/core/store';
import { requireAdmin, badRequest, fail, isStr } from '../../_lib/guards';

export const dynamic = 'force-dynamic';

/** Sales leads — platform admin only. */
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json({ leads: allLeads() });
}

/** Import rows (parsed from CSV/JSON in the browser). */
export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.rows)) return badRequest();
  return NextResponse.json(importLeads(body.rows.filter((r: unknown) => r && typeof r === 'object')));
}

export async function PATCH(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body || !isStr(body.id)) return badRequest();
  try {
    return NextResponse.json({ lead: updateLead(body.id, { status: body.status as LeadStatus | undefined, note: isStr(body.note) ? body.note : undefined }) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get('id') ?? '';
  try {
    deleteLead(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
