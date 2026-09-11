import { NextRequest, NextResponse } from 'next/server';
import { messageThread, sendMessage, markThreadRead, threadKeyForDevice } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const shopId = req.nextUrl.searchParams.get('shopId') ?? '';
  const customerKey = req.nextUrl.searchParams.get('customerKey') ?? '';
  return NextResponse.json({ messages: messageThread(shopId, customerKey) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const from = body.from === 'shop' ? 'shop' : 'customer';
  const shopId = String(body.shopId ?? '');
  // Bookings live in this process's store, so the device's real key for the
  // shop is only knowable here — resolve it rather than forking a thread.
  const customerKey =
    body.resolveKeyForDevice && typeof body.resolveKeyForDevice === 'string'
      ? threadKeyForDevice(shopId, body.resolveKeyForDevice)
      : String(body.customerKey ?? '');
  const message = sendMessage(shopId, customerKey, from, String(body.text ?? ''));
  if (!message) return NextResponse.json({ error: 'empty' }, { status: 400 });
  return NextResponse.json({ message });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const reader = body.reader === 'shop' ? 'shop' : 'customer';
  markThreadRead(String(body.shopId ?? ''), String(body.customerKey ?? ''), reader);
  return NextResponse.json({ ok: true });
}
