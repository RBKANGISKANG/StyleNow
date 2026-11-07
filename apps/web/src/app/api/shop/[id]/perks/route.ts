import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { accessFactsOf, birthdayPerkOf, setAccessFacts, setBirthdayPerk } from '@/core/store';
import { badRequest, fail } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ birthdayPerk: birthdayPerkOf(params.id), accessFacts: accessFactsOf(params.id) });
}

/** Set any of { birthdayPerk, accessFacts } — a key that is present is written. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (has('birthdayPerk') && typeof body.birthdayPerk !== 'number') return badRequest();
  const f = body.accessFacts;
  if (has('accessFacts') && f !== null && (typeof f !== 'object' || Array.isArray(f))) return badRequest();
  try {
    if (has('birthdayPerk')) setBirthdayPerk(params.id, body.birthdayPerk);
    if (has('accessFacts')) {
      setAccessFacts(params.id, f ? { stepFree: !!f.stepFree, wheelchairWC: !!f.wheelchairWC, quietCorner: !!f.quietCorner } : null);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
