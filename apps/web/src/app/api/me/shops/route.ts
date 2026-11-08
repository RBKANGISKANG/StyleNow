import { NextRequest, NextResponse } from 'next/server';
import { shopById, shopsForOwner, staffShopsFor } from '@/core/store';
import { callerKeys, sessionAccount } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** The salons connected to the caller's login and/or this browser. */
export async function GET(req: NextRequest) {
  const ids = new Set(callerKeys(req).flatMap((k) => shopsForOwner(k)));
  // Where a signed-in team member works (My day only — not owner rights).
  const acc = sessionAccount(req);
  const staff = acc
    ? staffShopsFor(acc.email).map((x) => ({ ...x, name: shopById(x.shopId)?.name ?? '', emoji: shopById(x.shopId)?.emoji ?? '💈' }))
    : [];
  return NextResponse.json({ shopIds: [...ids], staff });
}
