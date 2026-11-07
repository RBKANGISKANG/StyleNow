import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../_lib/guards';
import { emailConfigured, recentOutbox, smsConfigured } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/** The last 200 emails/SMS the server tried to send — "did the reminder go out?" */
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json({ emailConfigured: emailConfigured(), smsConfigured: smsConfigured(), outbox: recentOutbox() });
}
