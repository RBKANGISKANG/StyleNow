import { NextRequest, NextResponse } from 'next/server';
import { allApplications, approveApplication, rejectApplication } from '@/core/store';
import { requireAdmin, badRequest, fail, isStr } from '../../_lib/guards';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json({ applications: allApplications() });
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body || !isStr(body.id) || (body.action !== 'approve' && body.action !== 'reject')) return badRequest();
  try {
    const application =
      body.action === 'approve'
        ? approveApplication(body.id)
        : rejectApplication(body.id, isStr(body.reason) ? body.reason : '');
    return NextResponse.json({ application });
  } catch (e) {
    return fail(e);
  }
}
