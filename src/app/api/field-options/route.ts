import { NextRequest, NextResponse } from 'next/server';
import { legacyRequest } from '@/lib/server/legacyClient';
import { parseHtmlOptionsExact, looksLikeLoginPage } from '@/lib/server/htmlParsers';
import { getCachedFieldOptions, setCachedFieldOptions } from '@/lib/server/masterDataCache';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action');
  const value = request.nextUrl.searchParams.get('value');

  if (!action || !value) {
    return NextResponse.json(
      { error: 'Both "action" and "value" query parameters are required.' },
      { status: 400 }
    );
  }

  const legacySessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (!legacySessionCookie) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const cached = getCachedFieldOptions(action, value);
  if (cached) {
    return NextResponse.json(cached);
  }

  let result;
  try {
    // getField.php is a POST endpoint on the legacy side (matches the
    // original client-side fetchDynamicMap in apiUtils.ts) even though
    // our own route is exposed as GET to the browser — action/value come
    // in as query params here, then get forwarded as a POST body.
    result = await legacyRequest('/includes/getField.php', {
      method: 'POST',
      data: new URLSearchParams({ action, value }),
      legacySessionCookie,
    });
  } catch (error) {
    console.error(`Failed to fetch field options for ${action}=${value}:`, error);
    return NextResponse.json(
      { error: 'Could not reach the legacy backend for field options.' },
      { status: 502 }
    );
  }

  if (looksLikeLoginPage(result.data)) {
    return NextResponse.json(
      { error: 'Legacy session expired or invalid. Please log in again.' },
      { status: 401 }
    );
  }

  // getField.php replies with an option-list HTML fragment followed by a
  // '~'-delimited suffix — only the part before '~' is real option markup
  // (matches the original fetchDynamicMap's response.data.split('~')[0]).
  const htmlPart = result.data.split('~')[0];
  const options = parseHtmlOptionsExact(htmlPart);

  setCachedFieldOptions(action, value, options);

  return NextResponse.json(options);
}