import { NextRequest, NextResponse } from 'next/server';
import { bookingsForDevice, shopById, serviceOf } from '@/server/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const deviceId = req.nextUrl.searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json({ error: 'missing_device' }, { status: 400 });
  const bookings = bookingsForDevice(deviceId).map((b) => {
    const shop = shopById(b.shopId);
    return {
      id: b.id,
      reference: b.reference,
      status: b.status,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      totalCents: b.quote.totalCents,
      paidCents: b.paidCents,
      depositCents: b.quote.depositCents,
      cancellation: b.cancellation ?? null,
      policy: b.policySnapshot,
      shop: shop
        ? { slug: shop.slug, name: shop.name, emoji: shop.emoji, district: shop.district, gradient: shop.gradient }
        : null,
      services: b.serviceIds.map((id) => {
        const s = shop ? serviceOf(shop, id) : undefined;
        return s ? { name: s.name, emoji: s.emoji } : { name: { en: id, de: id }, emoji: '✨' };
      }),
      staffName: shop?.staff.find((s) => s.id === b.staffId)?.name ?? null,
    };
  });
  return NextResponse.json({ bookings });
}
