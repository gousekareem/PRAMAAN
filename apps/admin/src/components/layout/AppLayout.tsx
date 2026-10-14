import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { AppFooter } from './AppFooter';
import { useLiveStream } from '../../hooks/useLiveStream';
import type { Role } from '../../services/types';

const NAV: { to: string; label: string; roles?: Role[] }[] = [
  { to: '/', label: 'Overview' },
  { to: '/map', label: 'Map' },
  { to: '/officers', label: 'Officers' },
  { to: '/duties', label: 'Duties' },
  { to: '/evidence', label: 'Evidence' },
  { to: '/alerts', label: 'Alerts' },
  { to: '/devices', label: 'Devices' },
  { to: '/audit', label: 'Audit history', roles: ['ADMIN', 'SUPERVISOR'] },
];

export function AppLayout() {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const stream = useLiveStream(() => window.dispatchEvent(new CustomEvent('pramaan:changed')));
  const links = NAV.filter((n) => !n.roles || hasRole(...n.roles));
  return (
    <div className="flex min-h-screen flex-col bg-paper-50 text-ink-950">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-[1100] border-b border-ink-800 bg-ink-900 text-paper-50">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5 sm:px-6">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-[0.18em]">PRAMAAN</span>
            <span className="hidden text-xs text-paper-200/80 2xl:inline">
              Proof-of-presence review · academic prototype
            </span>
          </div>
          <nav aria-label="Primary" className="ml-4 hidden flex-1 gap-0.5 xl:flex">
            {links.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded px-2.5 py-1.5 text-sm ${isActive ? 'bg-ink-700 text-white' : 'text-paper-200 hover:bg-ink-800 hover:text-white'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span
              className="hidden items-center gap-1.5 whitespace-nowrap text-xs text-paper-200 sm:flex"
              aria-live="polite"
              title="Server-sent update stream"
            >
              <span
                className={`h-2 w-2 rounded-full ${stream === 'connected' ? 'bg-emerald-400' : stream === 'connecting' ? 'bg-amber-400' : 'bg-gray-400'}`}
                aria-hidden
              />
              {stream === 'connected'
                ? 'Updates on'
                : stream === 'connecting'
                  ? 'Connecting…'
                  : 'Updates paused'}
            </span>
            <span className="hidden whitespace-nowrap text-right leading-tight md:block">
              <span className="block text-sm">{user?.displayName}</span>
              <span className="block text-[11px] uppercase tracking-wide text-paper-200/80">
                {user?.role}
                {user?.isDemo ? ' · demo' : ''}
              </span>
            </span>
            <button
              type="button"
              className="whitespace-nowrap rounded border border-paper-200/40 px-2.5 py-1 text-xs hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-paper-50"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              Sign out
            </button>
            <button
              type="button"
              className="rounded border border-paper-200/40 px-2 py-1 text-xs xl:hidden"
              aria-expanded={open}
              aria-controls="mobile-nav"
              onClick={() => setOpen((o) => !o)}
            >
              Menu
            </button>
          </div>
        </div>
        {open && (
          <nav
            id="mobile-nav"
            aria-label="Primary mobile"
            className="border-t border-ink-800 px-4 pb-3 xl:hidden"
          >
            {links.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `block rounded px-2 py-2 text-sm ${isActive ? 'bg-ink-700' : 'hover:bg-ink-800'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <Outlet />
      </main>
      <AppFooter />
    </div>
  );
}
