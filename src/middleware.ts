import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  if (!hasSession) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.next();
}

// Only these routes require a session; the login page and all /api/*
// Route Handlers manage their own auth checks (or none, for /api/auth/login).
export const config = {
  matcher: ['/bulk-upload/:path*', '/qc-import/:path*'],
};