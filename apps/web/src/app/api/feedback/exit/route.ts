import { NextRequest, NextResponse } from 'next/server';
import { recordExitFeedback } from '@/core/store';
import { badRequest, isStr } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const a = body.answers;
  if ((body.kind !== 'account' && body.kind !== 'shop') || !isStr(body.subject) || !a || typeof a !== 'object' || Array.isArray(a)) {
    return badRequest();
  }
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) if (isStr(v)) answers[k.slice(0, 60)] = v.slice(0, 2000);
  recordExitFeedback(body.kind, body.subject, answers);
  return NextResponse.json({ ok: true });
}
