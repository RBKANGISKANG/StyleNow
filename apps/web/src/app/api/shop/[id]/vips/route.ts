import { requireShopAccess } from '@/app/api/_lib/guards';
import { NextRequest, NextResponse } from 'next/server';
import { toggleVip } from '@/core/store';
import { badRequest, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

/** Flip a customer's VIP flag; returns the new state. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  if (!isStr(body.customerKey) || !body.customerKey) return badRequest();
  return NextResponse.json({ vip: toggleVip(params.id, body.customerKey) });
}
