import { NextRequest, NextResponse } from 'next/server';
import { confirmBooking, HoldExpired, type PaymentMethod } from '@/core/store';

const METHODS: PaymentMethod[] = ['card', 'paypal', 'apple_pay', 'google_pay', 'sepa', 'at_salon'];

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  // only a masked label is accepted here — the client never sends a full PAN
  const payment =
    body?.payment && METHODS.includes(body.payment.method) && typeof body.payment.label === 'string'
      ? { method: body.payment.method as PaymentMethod, label: String(body.payment.label).slice(0, 40) }
      : undefined;
  try {
    const b = confirmBooking(params.id, payment);
    return NextResponse.json({ id: b.id, reference: b.reference, status: b.status, paidCents: b.paidCents });
  } catch (e) {
    if (e instanceof HoldExpired) {
      return NextResponse.json({ error: 'hold_expired' }, { status: 410 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
