import { NextRequest, NextResponse } from 'next/server';
import { legacyRequest, extractCookiePair } from '@/lib/server/legacyClient';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

const FAILURE_TEXT = 'User Name Or Password Wrong';

export async function POST(request: NextRequest) {
  let body: { userId?: string; password?: string };
  try {
    body = await request.json();
      console.log(body)

  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const { userId, password } = body;
  if (!userId || !password) {
    return NextResponse.json(
      { ok: false, message: 'Please enter both User ID and Password.' },
      { status: 400 }
    );
  }

  const params = new URLSearchParams();
  params.append('userid', userId);
  params.append('pwd', password);

  let result;
  try {
    result = await legacyRequest('/verify.php', { method: 'POST', data: params });
    console.log(result);
  } catch (error) {
    console.error('Login proxy failed:', error);
    return NextResponse.json(
      { ok: false, message: 'A network error occurred. Please check your connection.' },
      { status: 502 }
    );
  }

  if (typeof result.data === 'string' && result.data.includes(FAILURE_TEXT)) {
    return NextResponse.json(
      { ok: false, message: 'Invalid User ID or Password. Please try again.' },
      { status: 401 }
    );
  }

  if (!result.setCookie) {
    console.error('Legacy login appeared to succeed but no Set-Cookie was returned by verify.php.');
    return NextResponse.json(
      { ok: false, message: 'Login failed unexpectedly. Please try again.' },
      { status: 502 }
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, extractCookiePair(result.setCookie), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });

  return response;
}