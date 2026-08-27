import { NextRequest, NextResponse } from 'next/server';
import { legacyRequest } from '@/lib/server/legacyClient';
import { parseModelListHtml, looksLikeLoginPage } from '@/lib/server/htmlParsers';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name');
  if (!name) {
    return NextResponse.json({ error: '"name" query parameter is required.' }, { status: 400 });
  }

  const legacySessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (!legacySessionCookie) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let result;
  try {
    // Cache-busting param, matching the original searchModelsByName —
    // this is a plain server-rendered GET, not an API designed for
    // polling, and we want the current state every time.
    result = await legacyRequest('/master/model_master_new.php', {
      method: 'GET',
      params: { srch: name, _: String(Date.now()) },
      legacySessionCookie,
    });
  } catch (error) {
    console.error(`Failed to search models for "${name}":`, error);
    return NextResponse.json(
      { error: 'Could not reach the legacy backend for model search.' },
      { status: 502 }
    );
  }

  if (looksLikeLoginPage(result.data)) {
    return NextResponse.json(
      { error: 'Legacy session expired or invalid. Please log in again.' },
      { status: 401 }
    );
  }

  const rows = parseModelListHtml(result.data);
  return NextResponse.json(rows);
}