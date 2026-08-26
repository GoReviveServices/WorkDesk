const BASE_URL = process.env.GOREVIVE_BASE_URL;

export interface LegacyRequestOptions {
  method?: 'GET' | 'POST';
  data?: URLSearchParams | Record<string, string>;
  params?: Record<string, string>;
  legacySessionCookie?: string | null;
}

export interface LegacyResponse {
  data: string;
  setCookie: string | null;
  status: number;
}

function toURLSearchParams(
  data?: URLSearchParams | Record<string, string>
): URLSearchParams | undefined {
  if (!data) return undefined;
  return data instanceof URLSearchParams ? data : new URLSearchParams(data);
}

export async function legacyRequest(
  path: string,
  options: LegacyRequestOptions = {}
): Promise<LegacyResponse> {
  if (!BASE_URL) {
    throw new Error(
      'GOREVIVE_BASE_URL is not set. Copy .env.local.example to .env.local and fill it in.'
    );
  }

  const { method = 'GET', data, params, legacySessionCookie } = options;

  const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  }

  const headers: Record<string, string> = {
    Referer: `${BASE_URL}/`,
  };
  if (legacySessionCookie) headers.Cookie = legacySessionCookie;

  let body: string | undefined;
  if (method === 'POST') {
    const searchParams = toURLSearchParams(data);
    if (searchParams) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = searchParams.toString();
    }
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body,
    redirect: 'manual',
    cache: 'no-store',
  });

  const responseText = await response.text();
  const setCookie = response.headers.get('set-cookie');

  return { data: responseText, setCookie, status: response.status };
}

export function extractCookiePair(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0].trim();
}