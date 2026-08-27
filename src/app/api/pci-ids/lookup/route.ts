import { NextRequest, NextResponse } from 'next/server';
import { lookupPciId } from '@/lib/server/pciIdsSync';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

export async function GET(request: NextRequest) {
  const legacySessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!legacySessionCookie) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const vendor = request.nextUrl.searchParams.get('vendor');
  const device = request.nextUrl.searchParams.get('device');
  if (!vendor || !device) {
    return NextResponse.json({ error: '"vendor" and "device" query parameters are required.' }, { status: 400 });
  }

  try {
    const result = await lookupPciId(vendor, device);
    return NextResponse.json(result ? { vendorName: result.vendorName, deviceName: result.deviceName } : null);
  } catch (error) {
    console.error('PCI ID lookup failed:', error);
    return NextResponse.json({ error: 'Could not read the PCI ID database.' }, { status: 502 });
  }
}