import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthContext } from '../auth/AuthContext';
import type { Role } from '../services/types';

export function authValue(role: Role | null) {
  return {
    user: role
      ? {
          id: 'u1',
          email: 'x@pramaan.demo',
          displayName: `Test ${role}`,
          role,
          officerId: null,
          isDemo: true,
        }
      : null,
    status: role ? ('authenticated' as const) : ('anonymous' as const),
    expired: false,
    login: vi.fn(),
    logout: vi.fn(async () => undefined),
    hasRole: (...roles: Role[]) => !!role && roles.includes(role),
    getToken: () => (role ? 'token' : null),
  };
}

export function renderWith(
  ui: ReactNode,
  { role = 'SUPERVISOR' as Role | null, route = '/' } = {},
) {
  return render(
    <AuthContext.Provider value={authValue(role)}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </AuthContext.Provider>,
  );
}

type Handler = (url: string, init?: RequestInit) => unknown;

/** Routes fetch() calls to handlers by URL substring. Unmatched calls return 404. */
export function mockFetch(routes: Record<string, Handler | unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => url.includes(k));
    if (!key)
      return new Response(
        JSON.stringify({
          error: { code: 'NOT_FOUND', message: 'not mocked', requestId: 'req-test' },
        }),
        { status: 404 },
      );
    const r = routes[key];
    const body = typeof r === 'function' ? (r as Handler)(url, init) : r;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

export const emptyPage = { items: [], page: 1, pageSize: 25, total: 0, totalPages: 1 };
