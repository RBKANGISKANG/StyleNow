import { NextResponse } from 'next/server';
import { leadPrefill } from '@/core/store';

export const dynamic = 'force-dynamic';

/** Pre-fill for an invite link — only the salon's public business details. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const lead = leadPrefill(params.id);
  return lead ? NextResponse.json({ lead }) : NextResponse.json({ error: 'not_found' }, { status: 404 });
}
