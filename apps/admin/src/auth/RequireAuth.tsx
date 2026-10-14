import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import type { Role } from '../services/types';
import { LoadingState } from '../components/ui/States';

export function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <LoadingState label="Restoring session…" />;
  if (status !== 'authenticated' || !user)
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) {
    return (
      <div role="alert" className="m-8 rounded border border-signal-bad/30 bg-white p-6 text-sm">
        <h2 className="font-semibold text-signal-bad">Not authorised</h2>
        <p className="mt-1 text-ink-800">Your role ({user.role}) cannot open this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}
