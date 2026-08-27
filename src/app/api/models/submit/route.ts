import { NextRequest, NextResponse } from 'next/server';
import { legacyRequest } from '@/lib/server/legacyClient';
import { parseLegacyFormResponse, looksLikeLoginPage } from '@/lib/server/htmlParsers';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

export async function POST(request: NextRequest) {
  const legacySessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (!legacySessionCookie) {
    return NextResponse.json({ success: false, message: 'Not authenticated.' }, { status: 401 });
  }

  let payload: Record<string, string>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const params = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => {
    params.append(key, String(value));
  });
  params.append('Submit', 'ADD');

  let result;
  try {
    result = await legacyRequest('/master/addmodel_new_all.php', {
      method: 'POST',
      data: params,
      legacySessionCookie,
    });
  } catch (error) {
    console.error('Model submission proxy failed:', error);
    return NextResponse.json(
      { success: false, message: 'A network error occurred while submitting.' },
      { status: 502 }
    );
  }

  // This is a real create action, not a read — silently mis-parsing an
  // expired-session response as a plain "failure" would be actively
  // confusing (looks like a validation problem, not an auth problem).
  // Surface it distinctly instead.
  if (looksLikeLoginPage(result.data)) {
    return NextResponse.json(
      { success: false, message: 'Legacy session expired or invalid. Please log in again.' },
      { status: 401 }
    );
  }

  const parsed = parseLegacyFormResponse(result.data);
  return NextResponse.json(parsed);
}