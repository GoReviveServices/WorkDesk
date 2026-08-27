import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@/lib/shared/sessionCookie';

/**
 * Reads the legacy session cookie pair (e.g. "PHPSESSID=abc123") stored in
 * OUR httpOnly cookie, for use as the `cookie` option in legacyRequest().
 * Returns null if the user isn't logged in.
 */
export async function getLegacySessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
