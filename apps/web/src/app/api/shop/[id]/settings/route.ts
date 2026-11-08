import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import {
  membershipOffer,
  quietDiscountOf,
  resourcesOf,
  setMembershipOffer,
  setQuietDiscount,
  setResources,
  setShopAnnouncement,
  setShopGoal,
  shopAnnouncement,
  shopGoal,
} from '@/core/store';
import { badRequest, fail, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** The shop's scalar settings: goal, announcement, quiet discount, resources, membership offer. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return NextResponse.json({
    goal: shopGoal(params.id),
    announcement: shopAnnouncement(params.id),
    quietDiscount: quietDiscountOf(params.id),
    resources: resourcesOf(params.id),
    membershipOffer: membershipOffer(params.id),
  });
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Set any of the GET keys — a key that is present is written. */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (has('goal') && !isNum(body.goal)) return badRequest();
  if (has('announcement') && !isStr(body.announcement)) return badRequest();
  if (has('quietDiscount') && typeof body.quietDiscount !== 'number') return badRequest();
  const r = body.resources;
  if (has('resources') && !(isObj(r) && isNum(r.basins) && isNum(r.colourStations))) return badRequest();
  const m = body.membershipOffer;
  if (has('membershipOffer') && m !== null && !(isObj(m) && isNum(m.priceCents) && isNum(m.discountPct))) {
    return badRequest();
  }
  try {
    if (has('goal')) setShopGoal(params.id, body.goal);
    if (has('announcement')) setShopAnnouncement(params.id, body.announcement);
    if (has('quietDiscount')) setQuietDiscount(params.id, body.quietDiscount);
    if (has('resources')) setResources(params.id, { basins: r.basins, colourStations: r.colourStations });
    if (has('membershipOffer')) {
      setMembershipOffer(params.id, m ? { priceCents: m.priceCents, discountPct: m.discountPct } : null);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
