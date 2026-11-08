import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import {
  checklistCompletion,
  checklistTicks,
  checklists,
  deleteChecklist,
  saveChecklist,
  tickChecklistItem,
} from '@/core/store';
import { badRequest, fail, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Templates; with ?iso= also that day's ticks and completion. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const iso = req.nextUrl.searchParams.get('iso');
  if (iso && !ISO.test(iso)) return badRequest();
  return NextResponse.json({
    checklists: checklists(params.id),
    ...(iso ? { ticks: checklistTicks(params.id, iso), completion: checklistCompletion(params.id, iso) } : {}),
  });
}

/** Save (create or replace) a template. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const tpl = body.template;
  if (
    !tpl ||
    !['opening', 'closing', 'weekly'].includes(tpl.kind) ||
    (tpl.id != null && !isStr(tpl.id)) ||
    !Array.isArray(tpl.items) ||
    !tpl.items.every((i: { id?: unknown; label?: unknown }) => i && isStr(i.label) && (i.id == null || isStr(i.id)))
  ) {
    return badRequest();
  }
  try {
    const saved = saveChecklist(params.id, {
      id: tpl.id ?? undefined,
      kind: tpl.kind,
      items: tpl.items.map((i: { id?: string; label: string }) => ({ id: i.id ?? '', label: i.label })),
    });
    return NextResponse.json({ checklist: saved }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

/** Toggle the tick on { iso, itemId } for { staffId }. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (!isStr(body.iso) || !ISO.test(body.iso) || !isStr(body.itemId) || !isStr(body.staffId)) return badRequest();
  tickChecklistItem(params.id, body.iso, body.itemId, body.staffId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const checklistId = req.nextUrl.searchParams.get('checklistId');
  if (!checklistId) return badRequest();
  deleteChecklist(params.id, checklistId);
  return NextResponse.json({ ok: true });
}
