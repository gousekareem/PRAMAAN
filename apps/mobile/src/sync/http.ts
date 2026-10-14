export type NetworkErrorKind = 'TIMEOUT' | 'UNREACHABLE' | 'TLS' | 'CAPTIVE_PORTAL' | 'UNKNOWN';

export class NetworkError extends Error {
  constructor(
    public readonly kind: NetworkErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface HttpResponse {
  status: number;
  json: unknown;
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  json?: unknown;
  file?: { uri: string; name: string; type: string };
  token?: string | null;
  timeoutMs?: number;
}

export interface HttpClient {
  send(req: HttpRequest): Promise<HttpResponse>;
}

/**
 * fetch()-based client. A response that is not JSON from the PRAMAAN API (e.g. a captive
 * portal login page served with 200) is treated as a network failure, never as success.
 */
export class FetchHttpClient implements HttpClient {
  constructor(private readonly baseUrl: string) {
    if (
      !/^https:\/\//.test(baseUrl) &&
      !/^http:\/\/(10\.0\.2\.2|localhost|127\.0\.0\.1|192\.168\.)/.test(baseUrl)
    ) {
      throw new Error('API base URL must use HTTPS (plain HTTP only for local development hosts)');
    }
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 30_000);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (req.token) headers.Authorization = `Bearer ${req.token}`;
    let body: FormData | string | undefined;
    if (req.file) {
      const fd = new FormData();
      // React Native's FormData accepts { uri, name, type } file descriptors.
      fd.append('file', req.file as unknown as Blob);
      body = fd;
    } else if (req.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.json);
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${req.path}`, {
        method: req.method,
        headers,
        body,
        signal: ctrl.signal,
      });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if ((e as Error)?.name === 'AbortError')
        throw new NetworkError('TIMEOUT', 'Request timed out');
      if (/ssl|certificate|tls|handshake/i.test(msg))
        throw new NetworkError('TLS', 'TLS failure (certificate not trusted)');
      throw new NetworkError(
        'UNREACHABLE',
        'Server unreachable (no route, DNS failure or offline)',
      );
    } finally {
      clearTimeout(timer);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      if (res.status === 204) return { status: 204, json: null };
      throw new NetworkError(
        'CAPTIVE_PORTAL',
        `Unexpected non-JSON response (HTTP ${res.status}); possibly a captive portal`,
      );
    }
    return { status: res.status, json: await res.json().catch(() => null) };
  }
}
