import { NextRequest, NextResponse } from 'next/server';
import { isShopOwner, payoutAccount, shopById, commissionFreeUntil, PLATFORM_COMMISSION_PCT } from '@/core/store';
import { originFor, stripe, stripeConfigured, syncPayoutAccount } from '@/lib/stripe-server';

export const dynamic = 'force-dynamic';

/**
 * Automatic payouts for one salon (Stripe Connect, Express accounts).
 *
 * GET  ?shopId&ownerKey → the salon's payout status (refreshed from Stripe).
 * POST { shopId, ownerKey } → a one-time Stripe onboarding link. Stripe hosts
 * the identity and bank-account form; the salon never gives us its IBAN.
 */
function guard(shopId: string, ownerKey: string): NextResponse | null {
  if (!shopById(shopId)) return NextResponse.json({ error: 'shop_not_found' }, { status: 404 });
  if (!isShopOwner(shopId, ownerKey)) return NextResponse.json({ error: 'not_yours' }, { status: 403 });
  return null;
}

function view(shopId: string) {
  const a = payoutAccount(shopId);
  return {
    configured: stripeConfigured(),
    connected: Boolean(a),
    chargesEnabled: a?.chargesEnabled ?? false,
    payoutsEnabled: a?.payoutsEnabled ?? false,
    detailsSubmitted: a?.detailsSubmitted ?? false,
    commissionPct: PLATFORM_COMMISSION_PCT,
    freeUntil: commissionFreeUntil(shopId),
  };
}

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId') ?? '';
  const ownerKey = req.nextUrl.searchParams.get('ownerKey') ?? '';
  const refused = guard(shopId, ownerKey);
  if (refused) return refused;
  const a = payoutAccount(shopId);
  if (a && stripeConfigured()) {
    try {
      syncPayoutAccount(shopId, await stripe().accounts.retrieve(a.accountId));
    } catch {
      /* keep the last known status */
    }
  }
  return NextResponse.json(view(shopId));
}

export async function POST(req: NextRequest) {
  if (!stripeConfigured()) return NextResponse.json({ error: 'stripe_not_configured' }, { status: 501 });
  const body = (await req.json().catch(() => ({}))) as { shopId?: unknown; ownerKey?: unknown };
  const shopId = typeof body.shopId === 'string' ? body.shopId : '';
  const ownerKey = typeof body.ownerKey === 'string' ? body.ownerKey : '';
  const refused = guard(shopId, ownerKey);
  if (refused) return refused;
  try {
    let a = payoutAccount(shopId);
    if (!a) {
      const shop = shopById(shopId)!;
      const acct = await stripe().accounts.create(
        {
          type: 'express',
          country: 'DE',
          business_type: 'company',
          business_profile: { name: shop.name, mcc: '7230' },
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          settings: { payouts: { schedule: { interval: 'weekly', weekly_anchor: 'monday' } } },
          metadata: { shopId },
        },
        { idempotencyKey: `connect-${shopId}` },
      );
      a = syncPayoutAccount(shopId, acct);
    }
    const back = `${originFor(req)}/dashboard/shop?payouts=1`;
    const link = await stripe().accountLinks.create({
      account: a.accountId,
      type: 'account_onboarding',
      refresh_url: back,
      return_url: back,
    });
    return NextResponse.json({ url: link.url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
