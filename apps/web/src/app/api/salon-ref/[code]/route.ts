import { NextResponse } from 'next/server';
import { salonReferrerName } from '@/core/store';

export const dynamic = 'force-dynamic';

/** Public: the inviting salon's name, for the "invited by …" banner. */
export async function GET(_req: Request, props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  const name = salonReferrerName(code);
  return name ? NextResponse.json({ name }) : NextResponse.json({ error: 'not_found' }, { status: 404 });
}
