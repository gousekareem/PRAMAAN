import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthContext } from '../auth/AuthContext';
import type { Role } from '../services/types';

/** Mirrors the server's default permission sets for the roles used in tests. */
export const TEST_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ['web.login', 'dashboard.view', 'map.view', 'personnel.view', 'personnel.manage', 'availability.manage', 'users.manage', 'policy.manage', 'system.health', 'duty.view', 'duty.view_restricted', 'duty.create', 'duty.assign', 'duty.approve', 'duty.close', 'duty.instructions.publish', 'duty.handover.record', 'roster.view', 'checkin.view', 'evidence.view', 'evidence.view_image', 'evidence.export', 'evidence.package', 'exception.view', 'exception.manage', 'reports.view', 'reports.export', 'audit.view', 'audit.verify', 'device.view', 'device.approve', 'correction.request', 'correction.approve'],
  SUPERVISOR: ['web.login', 'dashboard.view', 'map.view', 'personnel.view', 'duty.view', 'duty.view_restricted', 'duty.create', 'duty.assign', 'duty.approve', 'duty.close', 'duty.instructions.publish', 'duty.handover.record', 'roster.view', 'checkin.view', 'evidence.view', 'evidence.view_image', 'evidence.export', 'evidence.package', 'exception.view', 'exception.manage', 'reports.view', 'reports.export', 'audit.view', 'device.view', 'availability.manage', 'correction.approve'],
  REVIEWER: ['web.login', 'dashboard.view', 'map.view', 'personnel.view', 'duty.view', 'roster.view', 'checkin.view', 'evidence.view', 'evidence.export', 'exception.view', 'reports.view', 'device.view'],
  SI: ['web.login', 'mobile.login', 'dashboard.view', 'map.view', 'duty.view', 'duty.view_restricted', 'duty.create', 'duty.assign', 'duty.approve', 'duty.close', 'duty.instructions.publish', 'duty.handover.record', 'roster.view', 'checkin.perform', 'checkin.view', 'evidence.view', 'evidence.view_image', 'evidence.export', 'personnel.view', 'availability.manage', 'exception.view', 'exception.manage', 'reports.view', 'reports.export', 'device.view', 'correction.request', 'correction.approve'],
  HC: ['web.login', 'mobile.login', 'dashboard.view', 'duty.view', 'roster.view', 'checkin.perform', 'checkin.view', 'evidence.view', 'personnel.view', 'exception.view', 'duty.handover.record', 'correction.request'],
  DSP: ['web.login', 'dashboard.view', 'map.view', 'duty.view', 'roster.view', 'checkin.view', 'evidence.view', 'personnel.view', 'exception.view', 'reports.view', 'reports.export', 'audit.view', 'device.view'],
  HG: ['web.login', 'mobile.login', 'duty.view', 'roster.view', 'checkin.perform', 'checkin.view', 'evidence.view', 'correction.request'],
  PC: ['web.login', 'mobile.login', 'duty.view', 'roster.view', 'checkin.perform', 'checkin.view', 'evidence.view', 'correction.request'],
};

export function authValue(role: Role | null) {
  const permissions = role ? (TEST_PERMISSIONS[role] ?? []) : [];
  return {
    user: role
      ? {
          id: 'u1',
          email: 'x@pramaan.demo',
          displayName: `Test ${role}`,
          role,
          officerId: ['HG', 'PC', 'HC', 'ASI', 'SI', 'CI', 'DSP'].includes(role) ? 'o1' : null,
          isDemo: true,
          permissions,
          roleLabel: role,
        }
      : null,
    status: role ? ('authenticated' as const) : ('anonymous' as const),
    expired: false,
    login: vi.fn(),
    logout: vi.fn(async () => undefined),
    hasRole: (...roles: Role[]) => !!role && roles.includes(role),
    can: (...p: string[]) => p.some((x) => permissions.includes(x)),
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
