import { NextRequest, NextResponse } from 'next/server';
import { getFieldCorrections } from '@/lib/server/fieldCorrections';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

export async function GET(request: NextRequest) {
  const legacySessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!legacySessionCookie) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const field = request.nextUrl.searchParams.get('field');
  const scope = request.nextUrl.searchParams.get('scope');
  if (!field || !scope) {
    return NextResponse.json({ error: '"field" and "scope" query parameters are required.' }, { status: 400 });
  }

  try {
    const docs = await getFieldCorrections(field, scope);
    return NextResponse.json(docs);
  } catch (error) {
    console.error('Failed to read field corrections:', error);
    return NextResponse.json({ error: 'Could not read field corrections.' }, { status: 502 });
  }
}