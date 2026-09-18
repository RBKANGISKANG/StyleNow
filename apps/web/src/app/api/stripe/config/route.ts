import { NextResponse } from 'next/server';
import { publishableKey, stripeConfigured } from '@/lib/stripe-server';

export const dynamic = 'force-dynamic';

/**
 * Whether there is a real processor behind this deployment, and the key the
 * browser needs to talk to it. The publishable key is safe to hand out by
 * design; the secret one never leaves the server.
 */
export async function GET() {
  return NextResponse.json({
    enabled: stripeConfigured(),
    publishableKey: stripeConfigured() ? publishableKey() : '',
  });
}
