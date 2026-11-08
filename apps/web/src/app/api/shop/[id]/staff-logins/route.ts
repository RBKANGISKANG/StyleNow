import { NextRequest, NextResponse } from 'next/server';
import { effectiveStaff, grantStaffLogin, revokeStaffLogin, shopById, staffLoginsFor } from '@/core/store';
import { badRequest, fail, isStr, requireShopAccess } from '@/app/api/_lib/guards';
import { sendEmail, siteOrigin } from '@/lib/notify';
import { originFor } from '@/lib/stripe-server';

export const dynamic = 'force-dynamic';

/** Team members who may sign in to My day — owner only. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  return NextResponse.json({ logins: staffLoginsFor(params.id) });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (!body || !isStr(body.email) || !isStr(body.staffId)) return badRequest();
  try {
    const login = grantStaffLogin(params.id, body.email, body.staffId);
    const shop = shopById(params.id);
    const who = effectiveStaff(params.id).find((m) => m.id === login.staffId)?.name ?? '';
    const link = `${siteOrigin(originFor(req))}/account`;
    void sendEmail(
      login.email,
      `${shop?.name ?? 'StyleNow'}: dein Zugang zu „Mein Tag“ / your "My day" access`,
      `Hallo ${who},\n\n${shop?.name ?? 'Dein Salon'} hat dir Zugang zu „Mein Tag“ bei StyleNow gegeben: deine Termine, deine Kundinnen und Kunden, Urlaub beantragen.\n\nLege mit genau dieser E-Mail-Adresse (${login.email}) ein Konto an oder melde dich an:\n${link}\n\n—\n\nHi ${who},\n\n${shop?.name ?? 'Your salon'} gave you access to "My day" on StyleNow. Create an account or sign in with this exact email address (${login.email}):\n${link}`,
    );
    return NextResponse.json({ login }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = requireShopAccess(req, params.id);
  if (denied) return denied;
  const email = req.nextUrl.searchParams.get('email') ?? '';
  if (!email) return badRequest();
  revokeStaffLogin(params.id, email);
  return NextResponse.json({ ok: true });
}
