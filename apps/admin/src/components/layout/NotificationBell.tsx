import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import type { NotificationItem } from '../../services/types';
import { formatTime } from '../ui/Misc';
import { t } from '../../i18n';

/**
 * In-app notifications. Retrieving the list is what the server records as DELIVERED; nothing
 * is pushed to phones in this prototype, so "delivered" never means more than "seen by this app".
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: NotificationItem[]; unread: number }>('/api/v1/notifications?limit=20');
      setItems(r.items);
      setUnread(r.unread);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60_000);
    const onChange = () => void load();
    window.addEventListener('pramaan:changed', onChange);
    return () => {
      clearInterval(id);
      window.removeEventListener('pramaan:changed', onChange);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${t('nav.notifications')}${unread ? ` (${unread} unread)` : ''}`}
        onClick={() => {
          setOpen((o) => !o);
          void load();
        }}
        className="relative rounded border border-paper-200/40 px-2 py-1 text-xs hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-paper-50"
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[1.1rem] rounded-full bg-amber-400 px-1 text-center text-[10px] font-semibold text-ink-950">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('nav.notifications')}
          className="absolute right-0 top-9 z-[1200] w-[min(92vw,24rem)] rounded-lg border border-paper-200 bg-white text-ink-950 shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-paper-100 px-3 py-2">
            <p className="text-sm font-semibold">{t('nav.notifications')}</p>
            <button
              type="button"
              className="text-xs text-ink-700 underline"
              onClick={async () => {
                await api('/api/v1/notifications/read-all', { method: 'POST' });
                await load();
              }}
            >
              Mark all read
            </button>
          </div>
          {error && <p className="p-3 text-sm text-signal-bad">Notifications could not be loaded.</p>}
          {!error && !items.length && <p className="p-3 text-sm text-ink-700">No notifications.</p>}
          <ul className="max-h-96 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id} className={`border-b border-paper-100 px-3 py-2 text-sm ${n.deliveryStatus === 'READ' ? '' : 'bg-amber-50/50'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{n.title}</p>
                  {n.deliveryStatus !== 'READ' && (
                    <button
                      type="button"
                      className="shrink-0 text-xs text-ink-700 underline"
                      onClick={async () => {
                        await api(`/api/v1/notifications/${n.id}/read`, { method: 'POST' });
                        await load();
                      }}
                    >
                      Mark read
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-ink-800">{n.body}</p>
                <p className="mt-1 text-xs text-ink-600">
                  {formatTime(n.createdAt)} · {n.deliveryStatus.toLowerCase()}
                  {n.relatedType === 'duty_assignment' && n.relatedId && (
                    <>
                      {' · '}
                      <Link to={`/duties/${n.relatedId}`} className="underline" onClick={() => setOpen(false)}>
                        open duty
                      </Link>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
