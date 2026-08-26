import { NextRequest, NextResponse } from 'next/server';
import { legacyRequest } from '@/lib/server/legacyClient';
import { htmlToJson, looksLikeLoginPage } from '@/lib/server/htmlParsers';
import { getCachedMasterData, setCachedMasterData } from '@/lib/server/masterDataCache';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true';

  if (!forceRefresh) {
    const cached = getCachedMasterData();
    if (cached) {
      return NextResponse.json(cached);
    }
  }

  const legacySessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (!legacySessionCookie) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let result;
  try {
    result = await legacyRequest('/master/addmodel_new_all.php', {
      method: 'GET',
      legacySessionCookie,
    });
  } catch (error) {
    console.error('Failed to fetch master data:', error);
    return NextResponse.json(
      { error: 'Could not reach the legacy backend for master data.' },
      { status: 502 }
    );
  }

  // Guard against caching a logged-out response globally — this cache is
  // shared across every user, so poisoning it once would break everyone
  // until the TTL clears it.
  if (looksLikeLoginPage(result.data)) {
    return NextResponse.json(
      { error: 'Legacy session expired or invalid. Please log in again.' },
      { status: 401 }
    );
  }

  const masterData = htmlToJson(result.data);
  setCachedMasterData(masterData);

  return NextResponse.json(masterData);
}