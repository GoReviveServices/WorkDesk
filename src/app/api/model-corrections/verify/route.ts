import { NextRequest, NextResponse } from 'next/server';
import { recordModelVerification } from '@/lib/server/modelCorrections';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

export async function POST(request: NextRequest) {
  const legacySessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!legacySessionCookie) {
    return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  }

  let body: { brand?: string; rawValue?: string; correctValue?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const { brand, rawValue, correctValue } = body;
  if (!brand || !rawValue || !correctValue) {
    return NextResponse.json(
      { ok: false, error: 'brand, rawValue, and correctValue are all required.' },
      { status: 400 }
    );
  }

  try {
    const result = await recordModelVerification(brand, rawValue, correctValue);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('Failed to record model verification:', error);
    return NextResponse.json({ ok: false, error: 'Could not store the verification.' }, { status: 502 });
  }
}