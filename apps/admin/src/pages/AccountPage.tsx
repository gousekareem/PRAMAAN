import { useState, type FormEvent } from 'react';
import { api, errorText, send } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Card, KV, PageHeader, formatTime } from '../components/ui/Misc';
import { ErrorState, LoadingState } from '../components/ui/States';
import { Badge } from '../components/ui/Badges';
import { Field, Notice } from '../components/ops/Ops';
import { personnelClassOf } from './personnelClass';
import { t, tCode } from '../i18n';

interface Me {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: string;
    roleLabel: string;
    scopeLevel: string;
    isDemo: boolean;
    lastLoginAt: string | null;
    permissions: string[];
    personnel: {
      personnelRef: string;
      personnelCategory: 'POLICE' | 'HOME_GUARD';
      rank: string | null;
      constableCategory: 'AR' | 'GENERAL' | null;
      unitName: string | null;
    } | null;
  };
}

const SCOPE_TEXT: Record<string, string> = {
  SELF: 'Your own records only',
  UNIT: 'Personnel of your unit',
  UNIT_TREE: 'Your unit and all units below it',
  ALL: 'All units (administrative scope)',
};

export function AccountPage() {
  const { logout } = useAuth();
  const me = useApi(() => api<Me>('/api/v1/auth/me'), []);
  const sessions = useApi(
    () => api<{ items: { familyId: string; startedAt: string; lastRefreshedAt: string; expiresAt: string; isDevice: boolean; current: boolean }[] }>('/api/v1/auth/sessions'),
    [],
  );
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) {
      setNotice({ ok: false, text: 'The new passwords do not match.' });
      return;
    }
    try {
      await send('/api/v1/auth/change-password', 'POST', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      setNotice({ ok: true, text: 'Password changed. Your other sessions were signed out.' });
      await sessions.reload();
    } catch (x) {
      setNotice({ ok: false, text: errorText(x) });
    }
  }

  if (me.loading && !me.data) return <LoadingState />;
  if (me.error) return <ErrorState error={me.error} onRetry={me.reload} />;
  const u = me.data!.user;
  return (
    <>
      <PageHeader title={t('account.title')} subtitle="Your profile, the permissions your role grants, and your active sign-in sessions." />
      {notice && <Notice tone={notice.ok ? 'ok' : 'bad'}>{notice.text}</Notice>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Profile">
          <dl>
            <KV k="Name" stacked>{u.displayName}</KV>
            <KV k="Login" stacked>{u.email}</KV>
            <KV k="Role" stacked>
              {u.roleLabel} {u.isDemo && <Badge tone="warn">{t('app.demoData')}</Badge>}
            </KV>
            {u.personnel && (
              <>
                <KV k="Personnel ID" stacked>{u.personnel.personnelRef}</KV>
                <KV k="Classification" stacked>{tCode('class', personnelClassOf(u.personnel))}</KV>
                <KV k="Unit" stacked>{u.personnel.unitName ?? '—'}</KV>
              </>
            )}
            <KV k="Data scope" stacked>{SCOPE_TEXT[u.scopeLevel] ?? u.scopeLevel}</KV>
            <KV k="Last sign-in" stacked>{formatTime(u.lastLoginAt)}</KV>
          </dl>
          <p className="mt-2 text-xs text-ink-700">Your role, rank and unit can only be changed by an authorised administrator.</p>
        </Card>
        <Card title={`Permissions (${u.permissions.length})`}>
          <p className="mb-2 text-xs text-ink-700">Prototype defaults, configurable by the department. The server checks every request against this list.</p>
          <ul className="flex flex-wrap gap-1">
            {u.permissions.map((p) => (
              <li key={p}>
                <code className="rounded bg-paper-100 px-1.5 py-0.5 text-[11px]">{p}</code>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Sessions">
          {sessions.data?.items.map((s) => (
            <div key={s.familyId} className="mb-2 rounded border border-paper-200 p-2 text-sm">
              <p>
                {s.isDevice ? 'Duty device' : 'Web browser'} {s.current && <Badge tone="info">this session</Badge>}
              </p>
              <p className="text-xs text-ink-700">
                Started {formatTime(s.startedAt)} · refreshed {formatTime(s.lastRefreshedAt)} · expires {formatTime(s.expiresAt)}
              </p>
              {!s.current && (
                <button
                  type="button"
                  className="mt-1 text-xs underline"
                  onClick={() =>
                    api(`/api/v1/auth/sessions/${s.familyId}/revoke`, { method: 'POST' })
                      .then(() => sessions.reload())
                      .catch((e) => setNotice({ ok: false, text: errorText(e) }))
                  }
                >
                  Sign out this session
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn-secondary mt-1" onClick={() => void logout()}>
            Sign out here
          </button>
        </Card>
        <Card title="Change password" className="lg:col-span-1">
          <form onSubmit={(e) => void changePassword(e)} className="space-y-2">
            <Field label="Current password">
              <input type="password" autoComplete="current-password" className="input w-full" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </Field>
            <Field label="New password" hint="12+ characters with upper- and lower-case letters and a digit.">
              <input type="password" autoComplete="new-password" className="input w-full" required minLength={12} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
            <Field label="Confirm new password">
              <input type="password" autoComplete="new-password" className="input w-full" required minLength={12} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
            <button type="submit" className="btn-primary">
              Change password
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
