import axios, { type AxiosRequestConfig } from 'axios';

const BASE_URL = process.env.GOREVIVE_BASE_URL;

export function extractCookiePair(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0].trim();
}

export interface LegacyResponse {
  data: string;
  setCookie: string | null;
  status: number;
}

const MIN_LEGACY_REQUEST_GAP_MS = 500;
let legacyRequestQueue: Promise<void> = Promise.resolve();

function throttleLegacyRequest(): Promise<void> {
  const wait = legacyRequestQueue.then(
    () => new Promise<void>((resolve) => setTimeout(resolve, MIN_LEGACY_REQUEST_GAP_MS))
  );
  legacyRequestQueue = wait.catch(() => {});
  return wait;
}

export async function legacyRequest(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    data?: URLSearchParams;
    params?: Record<string, string>;
    legacySessionCookie?: string;
  } = {}
): Promise<LegacyResponse> {
  if (!BASE_URL) {
    throw new Error(
      'GOREVIVE_BASE_URL is not set. Copy .env.local.example to .env.local and fill it in.'
    );
  }

  await throttleLegacyRequest();

  const { method = 'GET', data, params, legacySessionCookie } = options;

  let redirectSetCookie: string | string[] | null = null;

  const config: AxiosRequestConfig = {
    method,
    url: `${BASE_URL}${path}`,
    params,
    data,
    headers: {
      ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(legacySessionCookie ? { Cookie: legacySessionCookie } : {}),
      Referer: `${BASE_URL}/`,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    validateStatus: () => true,
    // Capture Set-Cookie from any redirect hop before axios follows it,
    // since verify.php likely sets the session cookie on its 302, not
    // on the final page it redirects to.
    beforeRedirect: (_redirectOptions, { headers }) => {
      if (headers['set-cookie']) {
        redirectSetCookie = headers['set-cookie'];
        console.log('beforeRedirect set-cookie captured:', headers['set-cookie']);
      }
    },
  } as AxiosRequestConfig;

  const response = await axios.request(config);

  const rawSetCookie = redirectSetCookie ?? response.headers['set-cookie'];
  const setCookie = Array.isArray(rawSetCookie) ? rawSetCookie[0] : (rawSetCookie ?? null);

  return {
    data: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
    setCookie,
    status: response.status,
  };
}