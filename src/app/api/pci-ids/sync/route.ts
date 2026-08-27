import { NextRequest, NextResponse } from 'next/server';
import { syncPciIds } from '@/lib/server/pciIdsSync';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

export async function POST(request: NextRequest) {
  const legacySessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!legacySessionCookie) {
    return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  }

  try {
    const result = await syncPciIds();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('PCI ID sync failed:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 502 }
    );
  }
}