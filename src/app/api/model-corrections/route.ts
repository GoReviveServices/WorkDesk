import { NextRequest, NextResponse } from 'next/server';
import { getModelCorrectionsForBrand } from '@/lib/server/modelCorrections';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

export async function GET(request: NextRequest) {
  const legacySessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!legacySessionCookie) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const brand = request.nextUrl.searchParams.get('brand');
  if (!brand) {
    return NextResponse.json({ error: '"brand" query parameter is required.' }, { status: 400 });
  }

  try {
    const docs = await getModelCorrectionsForBrand(brand);
    return NextResponse.json(docs);
  } catch (error) {
    console.error('Failed to read model corrections:', error);
    return NextResponse.json({ error: 'Could not read model corrections.' }, { status: 502 });
  }
}