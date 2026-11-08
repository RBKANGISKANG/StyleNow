import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Which social sign-ins this server can offer. */
export async function GET() {
  return NextResponse.json({ google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) });
}
