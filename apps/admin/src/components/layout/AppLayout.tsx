import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { AppFooter } from './AppFooter';
import { useLiveStream } from '../../hooks/useLiveStream';
import { NotificationBell } from './NotificationBell';
import { t } from '../../i18n';
import type { MessageKey } from '../../i18n/en';

interface NavItem {
  to: string;
  label: MessageKey;
  /** Shown when the user holds any of these permissions. Omit = every signed-in user. */
  anyOf?: string[];
  /** Shown only to accounts linked to a personnel record. */
  personnelOnly?: boolean;
  end?: boolean;
  indent?: boolean;
}

export const NAV_GROUPS: { title: MessageKey; items: NavItem[] }[] = [
  {
    title: 'nav.group.overview',
    items: [
      { to: '/', label: 'nav.overview', anyOf: ['dashboard.view'], end: true },
      { to: '/my', label: 'nav.myDuties', personnelOnly: true },
    ],
  },
  {
    title: 'nav.group.operations',
    items: [
      { to: '/duties', label: 'nav.dutyAssignments', anyOf: ['duty.view'], end: true },
      { to: '/duties/category/train-beats', label: 'nav.trainBeats', anyOf: ['duty.view'], indent: true },
      { to: '/duties/category/station-watches', label: 'nav.stationWatches', anyOf: ['duty.view'], indent: true },
      { to: '/duties/category/vip-escorts', label: 'nav.vipEscorts', anyOf: ['duty.view'], indent: true },
      { to: '/duties/category/track-incidents', label: 'nav.trackIncidents', anyOf: ['duty.view'], indent: true },
      { to: '/roster', label: 'nav.roster', anyOf: ['roster.view'] },
      { to: '/checkins', label: 'nav.checkins', anyOf: ['checkin.view'] },
      { to: '/map', label: 'nav.map', anyOf: ['map.view'] },
      { to: '/duty-sessions', label: 'nav.sessions', anyOf: ['duty.create'] },
    ],
  },
  {
    title: 'nav.group.records',
    items: [
      { to: '/personnel', label: 'nav.personnel', anyOf: ['personnel.view'] },
      { to: '/evidence', label: 'nav.evidence', anyOf: ['evidence.view'] },
      { to: '/alerts', label: 'nav.exceptions', anyOf: ['exception.view'] },
      { to: '/corrections', label: 'nav.corrections', anyOf: ['correction.request', 'correction.approve'] },
      { to: '/reports', label: 'nav.reports', anyOf: ['reports.view'] },
      { to: '/audit', label: 'nav.audit', anyOf: ['audit.view'] },
    ],
  },
  {
    title: 'nav.group.admin',
    items: [
      { to: '/devices', label: 'nav.devices', anyOf: ['device.view'] },
      { to: '/admin/accounts', label: 'nav.accounts', anyOf: ['users.manage'] },
      { to: '/admin/policy', label: 'nav.policy', anyOf: ['policy.manage', 'users.manage'] },
      { to: '/admin/system', label: 'nav.system', anyOf: ['system.health'] },
      { to: '/account', label: 'nav.account' },
    ],
  },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { can, user } = useAuth();
  return (
    <>
      {NAV_GROUPS.map((g) => {
        const items = g.items.filter(
          (n) => (!n.anyOf || can(...n.anyOf)) && (!n.personnelOnly || !!user?.officerId),
        );
        if (!items.length) return null;
        return (
          <div key={g.title} className="mb-4">
            <p className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-paper-200/60">
              {t(g.title)}
            </p>
            {items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `block rounded px-3 py-1.5 text-sm ${n.indent ? 'pl-6 text-[13px]' : ''} ${
                    isActive ? 'bg-ink-700 text-white' : 'text-paper-200 hover:bg-ink-800 hover:text-white'
                  }`
                }
              >
                {t(n.label)}
              </NavLink>
            ))}
          </div>
        );
      })}
    </>
  );
}

export function AppLayout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const streamAllowed = can('dashboard.view', 'exception.view');
  const stream = useLiveStream(
    () => window.dispatchEvent(new CustomEvent('pramaan:changed')),
    streamAllowed,
  );
  return (
    <div className="flex min-h-screen flex-col bg-paper-50 text-ink-950">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-[1100] border-b border-ink-800 bg-ink-900 text-paper-50">
        <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
          <button
            type="button"
            className="rounded border border-paper-200/40 px-2 py-1 text-xs lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((o) => !o)}
          >
            {t('nav.menu')}
          </button>
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="text-lg font-semibold tracking-[0.18em]">{t('app.name')}</span>
            <span className="hidden truncate text-xs text-paper-200/80 xl:inline">{t('app.tagline')}</span>
          </div>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {streamAllowed && (
              <span
                className="hidden items-center gap-1.5 whitespace-nowrap text-xs text-paper-200 sm:flex"
                aria-live="polite"
                title="Server-sent update stream"
              >
                <span
                  className={`h-2 w-2 rounded-full ${stream === 'connected' ? 'bg-emerald-400' : stream === 'connecting' ? 'bg-amber-400' : 'bg-gray-400'}`}
                  aria-hidden
                />
                {stream === 'connected' ? 'Updates on' : stream === 'connecting' ? 'Connecting…' : 'Updates paused'}
              </span>
            )}
            <NotificationBell />
            <span className="hidden whitespace-nowrap text-right leading-tight md:block">
              <span className="block text-sm">{user?.displayName}</span>
              <span className="block text-[11px] uppercase tracking-wide text-paper-200/80">
                {user?.roleLabel ?? user?.role}
                {user?.isDemo ? ` · ${t('app.demoData')}` : ''}
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
              {t('nav.signOut')}
            </button>
          </div>
        </div>
        {open && (
          <nav
            id="mobile-nav"
            aria-label="Primary mobile"
            className="max-h-[75vh] overflow-y-auto border-t border-ink-800 bg-ink-900 px-2 py-3 lg:hidden"
          >
            <NavList onNavigate={() => setOpen(false)} />
          </nav>
        )}
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 bg-ink-900 lg:block">
          <nav aria-label="Primary" className="sticky top-[49px] max-h-[calc(100vh-49px)] overflow-y-auto px-2 py-4">
            <NavList />
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
            <Outlet />
          </main>
          <AppFooter />
        </div>
      </div>
    </div>
  );
}
