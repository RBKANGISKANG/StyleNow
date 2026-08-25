import { NextRequest, NextResponse } from 'next/server';
import { toggleRule } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function PATCH(_req: NextRequest, { params }: { params: { id: string; rid: string } }) {
  try {
    return NextResponse.json({ enabled: toggleRule(params.id, params.rid) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
