import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, configureAuth } from '../services/api';
import { config } from '../services/config';
import type { Role, User } from '../services/types';

interface AuthState {
  user: User | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  expired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  /** True if the user holds ANY of the permissions (UI hint; the server re-checks every request). */
  can: (...permissions: string[]) => boolean;
  getToken: () => string | null;
}

const Ctx = createContext<AuthState | null>(null);

async function post(path: string, body?: unknown, token?: string | null) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-PRAMAAN-CSRF': '1',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${config.apiBaseUrl}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Session model: short-lived access token kept in memory only; refresh token is an
 * httpOnly cookie scoped to /api/v1/auth (not readable by JavaScript).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const tokenRef = useRef<string | null>(null);
  const refreshing = useRef<Promise<string | null> | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [expired, setExpired] = useState(false);

  const refresh = useCallback(async (): Promise<string | null> => {
    if (!refreshing.current) {
      refreshing.current = (async () => {
        try {
          const r = await post('/api/v1/auth/refresh');
          if (!r.ok) return null;
          const b = (await r.json()) as { accessToken: string; user: User };
          tokenRef.current = b.accessToken;
          setUser(b.user);
          setStatus('authenticated');
          return b.accessToken;
        } catch {
          return null;
        } finally {
          setTimeout(() => (refreshing.current = null), 0);
        }
      })();
    }
    return refreshing.current;
  }, []);

  const onSessionExpired = useCallback(() => {
    tokenRef.current = null;
    setUser(null);
    setExpired(true);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    configureAuth({ getToken: () => tokenRef.current, refresh, onSessionExpired });
    void refresh().then((t) => {
      if (!t) setStatus('anonymous');
    });
  }, [refresh, onSessionExpired]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await post('/api/v1/auth/login', { email, password, client: 'web' });
    if (!r.ok) {
      const b = (await r.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string; requestId?: string };
      };
      throw new ApiError(
        r.status,
        b.error?.code ?? 'HTTP_ERROR',
        b.error?.message ?? 'Sign-in failed',
        b.error?.requestId ?? null,
      );
    }
    const b = (await r.json()) as { accessToken: string; user: User };
    tokenRef.current = b.accessToken;
    setExpired(false);
    setUser(b.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/api/v1/auth/logout', undefined, tokenRef.current);
    } finally {
      tokenRef.current = null;
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      expired,
      login,
      logout,
      hasRole: (...roles) => !!user && roles.includes(user.role),
      can: (...perms) => !!user && perms.some((p) => user.permissions?.includes(p)),
      getToken: () => tokenRef.current,
    }),
    [user, status, expired, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

export { Ctx as AuthContext };
