import { useState, type FormEvent } from 'react';
import { api, errorText, qs, send } from '../services/api';
import type { Page, PersonnelItem } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { PageHeader, Pagination, formatTime } from '../components/ui/Misc';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { Badge, DemoBadge } from '../components/ui/Badges';
import { Field, Notice, TextActionDialog } from '../components/ops/Ops';
import { tCode } from '../i18n';

interface Account {
  id: string;
  email: string;
  displayName: string;
  role: string;
  roleLabel: string;
  officerId: string | null;
  personnelRef: string | null;
  isActive: boolean;
  isDemo: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
}
interface RoleInfo {
  code: string;
  label: string;
  requiresPersonnel: boolean;
}

export function AccountsPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [edit, setEdit] = useState<{ a: Account; role: string; isActive: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useApi(() => api<Page<Account>>(`/api/v1/accounts${qs({ page, q, pageSize: 30 })}`), [page, q]);
  const roles = useApi(() => api<{ roles: RoleInfo[] }>('/api/v1/policy/roles'), []);
  return (
    <>
      <PageHeader
        title="Login accounts"
        subtitle="Accounts are separate from personnel records. Role changes take effect immediately and end the account's existing sessions. Nobody can change their own role or status."
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreating((c) => !c)}>
            {creating ? 'Close' : 'New account'}
          </button>
        }
      />
      {notice && <Notice tone={notice.ok ? 'ok' : 'bad'}>{notice.text}</Notice>}
      {creating && roles.data && (
        <CreateAccount
          roles={roles.data.roles}
          onDone={(m) => {
            setNotice({ ok: true, text: m });
            setCreating(false);
            void list.reload();
          }}
          onError={(m) => setNotice({ ok: false, text: m })}
        />
      )}
      <div className="mb-3 max-w-sm">
        <Field label="Search">
          <input type="search" className="input w-full" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Email or name" />
        </Field>
      </div>
      {list.loading && !list.data && <LoadingState />}
      {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
      {list.data && !list.data.items.length && <EmptyState title="No accounts." />}
      {list.data && list.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-paper-200 bg-white">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Role</th>
                <th scope="col">Personnel</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.displayName} <DemoBadge show={a.isDemo} />
                    <p className="text-xs text-ink-700">{a.email}</p>
                  </td>
                  <td className="text-xs">{a.roleLabel}</td>
                  <td className="font-mono text-xs">{a.personnelRef ?? '—'}</td>
                  <td className="text-xs">{formatTime(a.lastLoginAt)}</td>
                  <td>{a.isActive ? <Badge tone="ok">Active</Badge> : <Badge tone="muted">Inactive</Badge>}</td>
                  <td className="text-xs">
                    {a.id !== user?.id ? (
                      <button type="button" className="underline" onClick={() => setEdit({ a, role: a.role, isActive: a.isActive })}>
                        Change role / status
                      </button>
                    ) : (
                      <span className="text-ink-600">your account</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} />}
      <TextActionDialog
        open={!!edit}
        title={edit ? `Change ${edit.a.displayName}` : ''}
        body="The change is audited and the account's current sessions end immediately."
        label="Reason"
        confirmLabel="Save"
        onCancel={() => setEdit(null)}
        onConfirm={async (reason) => {
          if (!edit) return;
          await send(`/api/v1/accounts/${edit.a.id}`, 'PATCH', { role: edit.role, isActive: edit.isActive, reason }).catch((e) => {
            throw new Error(errorText(e));
          });
          setNotice({ ok: true, text: 'Account updated.' });
          setEdit(null);
          await list.reload();
        }}
      >
        {edit && (
          <div className="grid gap-2">
            <Field label="Role">
              <select className="input w-full" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                {roles.data?.roles.map((r) => (
                  <option key={r.code} value={r.code} disabled={r.requiresPersonnel && !edit.a.officerId}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} /> Account active
            </label>
          </div>
        )}
      </TextActionDialog>
    </>
  );
}

function CreateAccount({ roles, onDone, onError }: { roles: RoleInfo[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ email: '', displayName: '', role: 'PC', officerId: '', password: '' });
  const people = useApi(() => api<Page<PersonnelItem>>('/api/v1/personnel?status=ACTIVE&pageSize=100'), []);
  const needs = roles.find((r) => r.code === f.role)?.requiresPersonnel;
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await send('/api/v1/accounts', 'POST', { ...f, officerId: f.officerId || null });
      onDone(`Account ${f.email} created.`);
    } catch (x) {
      onError(errorText(x));
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="mb-4 grid gap-3 rounded-lg border border-ink-600/30 bg-white p-4 md:grid-cols-3">
      <Field label="Email (login)">
        <input type="email" className="input w-full" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </Field>
      <Field label="Display name">
        <input className="input w-full" required minLength={2} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
      </Field>
      <Field label="Role">
        <select className="input w-full" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          {roles.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={`Linked personnel${needs ? ' (required)' : ''}`}>
        <select className="input w-full" value={f.officerId} required={needs} onChange={(e) => setF({ ...f, officerId: e.target.value })}>
          <option value="">—</option>
          {people.data?.items
            .filter((p) => !p.accountRole)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} · {tCode('class', p.personnelClass)}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Initial password" hint="12+ characters, upper/lower case and a digit. Share it securely.">
        <input type="password" autoComplete="new-password" className="input w-full" required minLength={12} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </Field>
      <div className="flex items-end">
        <button type="submit" className="btn-primary">
          Create account
        </button>
      </div>
    </form>
  );
}
