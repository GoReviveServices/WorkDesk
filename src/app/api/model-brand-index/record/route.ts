import { NextRequest, NextResponse } from 'next/server';
import { recordModelBrandMatch } from '@/lib/server/modelBrandIndex';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

export async function POST(request: NextRequest) {
  const legacySessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!legacySessionCookie) {
    return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  }

  let body: { rawModel?: string; brand?: string; crmModelMatch?: string; source?: 'auto' | 'manual_pick' };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const { rawModel, brand, crmModelMatch, source } = body;
  if (!rawModel || !brand || !crmModelMatch || !source) {
    return NextResponse.json(
      { ok: false, error: 'rawModel, brand, crmModelMatch, and source are all required.' },
      { status: 400 }
    );
  }

  try {
    const result = await recordModelBrandMatch(rawModel, brand, crmModelMatch, source);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('Failed to record model->brand match:', error);
    return NextResponse.json({ ok: false, error: 'Could not store the match.' }, { status: 502 });
  }
}