import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/server/mongodb';
import type { CategoryMapDoc } from '@/lib/server/categoryMapSync';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

export async function GET(request: NextRequest) {
  const legacySessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!legacySessionCookie) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  try {
    const db = await getDb();
    const docs = await db.collection<CategoryMapDoc>('category_map').find({}).toArray();
    const map = docs.map((d) => ({ category: d.category, subCategories: d.sub_categories }));
    return NextResponse.json(map);
  } catch (error) {
    console.error('Failed to read category map:', error);
    return NextResponse.json({ error: 'Could not read the category map.' }, { status: 502 });
  }
}