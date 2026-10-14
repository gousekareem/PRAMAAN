import { config } from './config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string | null,
  ) {
    super(message);
  }
}

type TokenProvider = {
  getToken: () => string | null;
  refresh: () => Promise<string | null>;
  onSessionExpired: () => void;
};

let provider: TokenProvider = {
  getToken: () => null,
  refresh: async () => null,
  onSessionExpired: () => undefined,
};

/** The access token lives only in memory (never localStorage). */
export function configureAuth(p: TokenProvider): void {
  provider = p;
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; requestId?: string };
    };
    return new ApiError(
      res.status,
      body.error?.code ?? 'HTTP_ERROR',
      body.error?.message ?? res.statusText,
      body.error?.requestId ?? res.headers.get('x-request-id'),
    );
  } catch {
    return new ApiError(
      res.status,
      'HTTP_ERROR',
      res.statusText || 'Request failed',
      res.headers.get('x-request-id'),
    );
  }
}

export async function rawRequest(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = provider.getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`${config.apiBaseUrl}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'The server could not be reached. Check your connection.',
      null,
    );
  }
  if (res.status === 401 && retry && token) {
    const fresh = await provider.refresh();
    if (fresh) return rawRequest(path, init, false);
    provider.onSessionExpired();
  }
  if (!res.ok) throw await parseError(res);
  return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await rawRequest(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Downloads a protected file via fetch (keeps the bearer token out of URLs). */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await rawRequest(path);
  const blob = await res.blob();
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
