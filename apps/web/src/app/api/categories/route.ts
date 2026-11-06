import { NextRequest, NextResponse } from 'next/server';
import { customCategories, addCustomCategory } from '@/core/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ categories: customCategories() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.label !== 'string' || !body.label.trim()) {
    return NextResponse.json({ error: 'missing_label' }, { status: 400 });
  }
  return NextResponse.json({ category: addCustomCategory(body.label) }, { status: 201 });
}
