import { NextRequest, NextResponse } from 'next/server';
import { legacyRequest, extractCookiePair } from '@/lib/server/legacyClient';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

const FAILURE_TEXT = 'User Name Or Password Wrong';

export async function POST(request: NextRequest) {
  let body: { userid?: string; pwd?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const { userid, pwd } = body;
  if (!userid || !pwd) {
    return NextResponse.json(
      { ok: false, message: 'Please enter both User ID and Password.' },
      { status: 400 }
    );
  }

  try {
const primeResult = await legacyRequest('/', { method: 'GET' });
const primedCookie = primeResult.setCookie ? extractCookiePair(primeResult.setCookie) : undefined;
    console.log('prime GET set-cookie:', primeResult.setCookie);

    const params = new URLSearchParams();
    params.append('userid', userid);
    params.append('pwd', pwd);

    const result = await legacyRequest('/verify.php', {
      method: 'POST',
      data: params,
      legacySessionCookie: primedCookie,
    });

    console.log('verify.php status:', result.status);
    console.log('verify.php response:', result.data);
    console.log('verify.php set-cookie:', result.setCookie);

    if (typeof result.data === 'string' && result.data.includes(FAILURE_TEXT)) {
      return NextResponse.json(
        { ok: false, message: 'Invalid User ID or Password. Please try again.' },
        { status: 401 }
      );
    }

    const finalCookie = result.setCookie ? extractCookiePair(result.setCookie) : primedCookie;

    if (!finalCookie) {
      console.error('Legacy login appeared to succeed but no session cookie is available.');
      return NextResponse.json(
        { ok: false, message: 'Login failed unexpectedly. Please try again.' },
        { status: 502 }
      );
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, finalCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 8,
    });

    return response;
  } catch (error) {
    console.error('Login proxy failed:', error);
    return NextResponse.json(
      { ok: false, message: 'A network error occurred. Please check your connection.' },
      { status: 502 }
    );
  }
}