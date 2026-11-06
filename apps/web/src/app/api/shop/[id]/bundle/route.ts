import { NextRequest, NextResponse } from 'next/server';
import { bundleDiscountOf, setBundleDiscount } from '@/core/store';

export const dynamic = 'force-dynamic';

/**
 * The combo percent has to live where holds are priced — the pricing engine
 * runs server-side in this mode, so a percent kept in the owner's browser
 * would be a promotion no customer could ever receive.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ pct: bundleDiscountOf(params.id) });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.pct !== 'number') {
    return NextResponse.json({ error: 'bad_percent' }, { status: 400 });
  }
  try {
    setBundleDiscount(params.id, body.pct);
    return NextResponse.json({ pct: bundleDiscountOf(params.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
