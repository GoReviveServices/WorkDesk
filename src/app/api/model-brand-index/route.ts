import { NextRequest, NextResponse } from 'next/server';
import { lookupModelBrand } from '@/lib/server/modelBrandIndex';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

export async function GET(request: NextRequest) {
  const legacySessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!legacySessionCookie) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const model = request.nextUrl.searchParams.get('model');
  if (!model) {
    return NextResponse.json({ error: '"model" query parameter is required.' }, { status: 400 });
  }

  try {
    const result = await lookupModelBrand(model);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to look up model->brand:', error);
    return NextResponse.json({ error: 'Could not read the model->brand index.' }, { status: 502 });
  }
}