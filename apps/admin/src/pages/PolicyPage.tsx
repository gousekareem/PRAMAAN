import { useState } from 'react';
import { api, errorText, send } from '../services/api';
import type { CategoryPolicy } from '../services/types';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Card, PageHeader } from '../components/ui/Misc';
import { ErrorState, LoadingState } from '../components/ui/States';
import { Badge } from '../components/ui/Badges';
import { CategoryBadge, Field, Notice, TextActionDialog } from '../components/ops/Ops';
import { t, tCode } from '../i18n';

interface Roles {
  roles: { code: string; label: string; description: string; scopeLevel: string; permissions: string[]; isRankRole: boolean }[];
  permissions: { code: string; description: string }[];
}

export function PolicyPage() {
  const { can } = useAuth();
  const manage = can('policy.manage');
  const cats = useApi(() => api<{ items: CategoryPolicy[]; personnelClasses: string[] }>('/api/v1/policy/duty-categories'), []);
  const roles = useApi(() => api<Roles>('/api/v1/policy/roles'), []);
  const [edit, setEdit] = useState<CategoryPolicy | null>(null);
  const [roleEdit, setRoleEdit] = useState<{ code: string; perms: Set<string> } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <>
      <PageHeader title={t('policy.title')} subtitle={t('policy.subtitle')} />
      {notice && <Notice tone={notice.ok ? 'ok' : 'bad'}>{notice.text}</Notice>}
      {cats.loading && !cats.data && <LoadingState />}
      {cats.error ? <ErrorState error={cats.error} onRetry={cats.reload} /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {cats.data?.items.map((c) => (
          <Card key={c.code}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <CategoryBadge category={c.code} restricted={c.isRestricted} />
              <span className="text-xs text-ink-700">policy v{c.policyVersion}</span>
            </div>
            <p className="text-sm text-ink-800">{c.description}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-ink-700">Check-in interval</dt>
              <dd>
                {c.checkinMinIntervalMin}–{c.checkinMaxIntervalMin} min (random)
              </dd>
              <dt className="text-ink-700">Response window</dt>
              <dd>{c.responseWindowSec} s</dd>
              <dt className="text-ink-700">Reporting window + grace</dt>
              <dd>
                {c.reportingWindowMin} + {c.graceMin} min
              </dd>
              <dt className="text-ink-700">Max duration</dt>
              <dd>{c.maxDurationHours} h</dd>
              <dt className="text-ink-700">Min personnel (warning)</dt>
              <dd>{c.minPersonnel}</dd>
              <dt className="text-ink-700">Supervisor expected</dt>
              <dd>{c.requiresSupervisor ? 'yes (warning)' : 'no'}</dd>
              <dt className="text-ink-700">Acceptance required</dt>
              <dd>{c.acceptRequired ? 'yes' : 'no'}</dd>
              <dt className="text-ink-700">Ineligible personnel</dt>
              <dd>{c.eligibilityMode === 'BLOCK' ? 'blocked' : 'allowed with warning'}</dd>
            </dl>
            <p className="mt-2 text-xs text-ink-700">Eligible:</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {c.eligible.map((e) => (
                <Badge key={e} tone="muted">
                  {tCode('class', e)}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-[11px] italic text-ink-600">{c.validationNote}</p>
            {manage && (
              <button type="button" className="btn-secondary mt-2" onClick={() => setEdit({ ...c })}>
                Edit policy
              </button>
            )}
          </Card>
        ))}
      </div>

      {roles.data && (
        <Card title="Roles and permissions (prototype defaults)" className="mt-6">
          <p className="mb-2 text-xs text-ink-700">
            Higher rank does not automatically grant every action: each role holds an explicit list of permissions and a data scope. AR/General is a constable
            attribute and grants no extra permissions.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 bg-paper-100 p-1.5 text-left">
                    Permission
                  </th>
                  {roles.data.roles.map((r) => (
                    <th key={r.code} scope="col" className="bg-paper-100 p-1.5 text-center" title={r.label}>
                      {r.code}
                      <span className="block font-normal text-ink-600">{r.scopeLevel.toLowerCase().replace('_', ' ')}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.data.permissions.map((p) => (
                  <tr key={p.code} className="border-b border-paper-100">
                    <th scope="row" className="sticky left-0 bg-white p-1.5 text-left font-normal" title={p.description}>
                      <code>{p.code}</code>
                    </th>
                    {roles.data!.roles.map((r) => (
                      <td key={r.code} className="p-1.5 text-center">
                        {r.permissions.includes(p.code) ? <span aria-label="granted">●</span> : <span className="text-paper-200" aria-label="not granted">·</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {manage && (
            <div className="mt-3 flex flex-wrap gap-2">
              {roles.data.roles.map((r) => (
                <button key={r.code} type="button" className="btn-secondary" onClick={() => setRoleEdit({ code: r.code, perms: new Set(r.permissions) })}>
                  Edit {r.code}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      <TextActionDialog
        open={!!edit}
        title={edit ? `Edit ${tCode('category', edit.code)} policy` : ''}
        body="Changes are versioned and audited. Use values validated by the department."
        label="Reason"
        confirmLabel="Save policy"
        onCancel={() => setEdit(null)}
        onConfirm={async (reason) => {
          if (!edit) return;
          await send(`/api/v1/policy/duty-categories/${edit.code}`, 'PATCH', {
            minPersonnel: edit.minPersonnel,
            requiresSupervisor: edit.requiresSupervisor,
            acceptRequired: edit.acceptRequired,
            eligibilityMode: edit.eligibilityMode,
            checkinMinIntervalMin: edit.checkinMinIntervalMin,
            checkinMaxIntervalMin: edit.checkinMaxIntervalMin,
            responseWindowSec: edit.responseWindowSec,
            reportingWindowMin: edit.reportingWindowMin,
            graceMin: edit.graceMin,
            eligible: edit.eligible,
            reason,
          }).catch((e) => {
            throw new Error(errorText(e));
          });
          setNotice({ ok: true, text: 'Policy updated (new version).' });
          setEdit(null);
          await cats.reload();
        }}
      >
        {edit && (
          <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto">
            {(
              [
                ['checkinMinIntervalMin', 'Min interval (min)'],
                ['checkinMaxIntervalMin', 'Max interval (min)'],
                ['responseWindowSec', 'Response window (s)'],
                ['reportingWindowMin', 'Reporting window (min)'],
                ['graceMin', 'Grace (min)'],
                ['minPersonnel', 'Min personnel'],
              ] as const
            ).map(([k, l]) => (
              <Field key={k} label={l}>
                <input type="number" className="input w-full" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) })} />
              </Field>
            ))}
            <Field label="Ineligible personnel">
              <select className="input w-full" value={edit.eligibilityMode} onChange={(e) => setEdit({ ...edit, eligibilityMode: e.target.value as 'BLOCK' | 'WARN' })}>
                <option value="BLOCK">Block</option>
                <option value="WARN">Allow with warning</option>
              </select>
            </Field>
            <div className="text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={edit.acceptRequired} onChange={(e) => setEdit({ ...edit, acceptRequired: e.target.checked })} /> Acceptance
                required
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={edit.requiresSupervisor} onChange={(e) => setEdit({ ...edit, requiresSupervisor: e.target.checked })} />{' '}
                Supervisor expected
              </label>
            </div>
            <fieldset className="col-span-2">
              <legend className="text-sm font-medium">Eligible personnel classes</legend>
              <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
                {cats.data?.personnelClasses.map((cls) => (
                  <label key={cls} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={edit.eligible.includes(cls)}
                      onChange={(e) =>
                        setEdit({ ...edit, eligible: e.target.checked ? [...edit.eligible, cls] : edit.eligible.filter((x) => x !== cls) })
                      }
                    />
                    {tCode('class', cls)}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}
      </TextActionDialog>
      <TextActionDialog
        open={!!roleEdit}
        title={roleEdit ? `Permissions of ${roleEdit.code}` : ''}
        body="Takes effect on the next request of every user with this role. You cannot remove policy/account administration from your own role."
        label="Reason"
        confirmLabel="Save permissions"
        onCancel={() => setRoleEdit(null)}
        onConfirm={async (reason) => {
          if (!roleEdit) return;
          await send(`/api/v1/policy/roles/${roleEdit.code}/permissions`, 'PUT', { permissions: [...roleEdit.perms], reason }).catch((e) => {
            throw new Error(errorText(e));
          });
          setNotice({ ok: true, text: `Permissions of ${roleEdit.code} updated.` });
          setRoleEdit(null);
          await roles.reload();
        }}
      >
        {roleEdit && (
          <div className="grid max-h-[50vh] grid-cols-1 gap-1 overflow-y-auto text-xs sm:grid-cols-2">
            {roles.data?.permissions.map((p) => (
              <label key={p.code} className="flex items-start gap-1" title={p.description}>
                <input
                  type="checkbox"
                  checked={roleEdit.perms.has(p.code)}
                  onChange={(e) => {
                    const n = new Set(roleEdit.perms);
                    if (e.target.checked) n.add(p.code);
                    else n.delete(p.code);
                    setRoleEdit({ ...roleEdit, perms: n });
                  }}
                />
                <code>{p.code}</code>
              </label>
            ))}
          </div>
        )}
      </TextActionDialog>
    </>
  );
}
