import { NextResponse } from 'next/server';
import { getBooking, type Booking, type PaymentMethod } from '@/core/store';
import { stripeConfigured } from '@/lib/stripe-server';

export const METHODS: PaymentMethod[] = ['card', 'paypal', 'apple_pay', 'google_pay', 'sepa', 'at_salon'];
/** Trust-the-client methods that must go through Stripe once it is configured. */
export const ONLINE_METHODS: PaymentMethod[] = ['card', 'paypal', 'apple_pay', 'google_pay', 'sepa'];

/** 403 'use_stripe_checkout' when a real processor exists and the client claims an online payment. */
export function stripeGuard(payment: unknown): NextResponse | null {
  const m = (payment as { method?: unknown } | null | undefined)?.method;
  if (stripeConfigured() && ONLINE_METHODS.includes(m as PaymentMethod)) {
    return NextResponse.json({ error: 'use_stripe_checkout' }, { status: 403 });
  }
  return null;
}

/** A masked payment label, or undefined; rejects unknown methods. */
export function cleanPayment(payment: unknown): { method: PaymentMethod; label: string } | undefined {
  const p = payment as { method?: unknown; label?: unknown } | null | undefined;
  if (!p || !METHODS.includes(p.method as PaymentMethod) || typeof p.label !== 'string') return undefined;
  return { method: p.method as PaymentMethod, label: String(p.label).slice(0, 40) };
}

/** The booking if `deviceId` owns it, else the error response to return. */
export function ownBooking(id: string, deviceId: unknown): { booking: Booking } | { error: NextResponse } {
  if (typeof deviceId !== 'string' || !deviceId) {
    return { error: NextResponse.json({ error: 'bad_request' }, { status: 400 }) };
  }
  const booking = getBooking(id);
  if (!booking) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  if (booking.deviceId !== deviceId) return { error: NextResponse.json({ error: 'not_yours' }, { status: 403 }) };
  return { booking };
}

export function errStatus(msg: string): number {
  if (msg === 'not_found' || msg.endsWith('_not_found')) return 404;
  if (msg === 'not_yours') return 403;
  return 409;
}

/** 400 'bad_request' — the body or query did not have the expected shape. */
export function badRequest(): NextResponse {
  return NextResponse.json({ error: 'bad_request' }, { status: 400 });
}

/** The engine's thrown message as a JSON error with the matching status. */
export function fail(e: unknown): NextResponse {
  const msg = (e as Error).message;
  return NextResponse.json({ error: msg }, { status: errStatus(msg) });
}

export const isStr = (v: unknown): v is string => typeof v === 'string';
export const isDevice = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
