import { NextRequest, NextResponse } from 'next/server';
import { giftTreatment } from '@/core/store';
import { cleanPayment, errStatus, stripeGuard } from '@/app/api/_lib/guards';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.serviceId !== 'string' || typeof body.deviceId !== 'string' || !body.deviceId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const blocked = stripeGuard(body.payment);
  if (blocked) return blocked;
  const payment = cleanPayment(body.payment);
  if (body.payment != null && !payment) return NextResponse.json({ error: 'bad_payment' }, { status: 400 });
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  try {
    const card = giftTreatment(
      params.id,
      body.deviceId,
      body.serviceId,
      { toName: str(body.toName, 60), fromName: str(body.fromName, 60), message: str(body.message, 200) },
      payment,
    );
    return NextResponse.json({ card }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: errStatus(msg) });
  }
}
