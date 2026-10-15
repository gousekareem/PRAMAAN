import { useState } from 'react';
import { api, download, errorText, qs } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import { Card, PageHeader } from '../components/ui/Misc';
import { ErrorState, LoadingState } from '../components/ui/States';
import { Field, Notice, UnitSelect } from '../components/ops/Ops';
import { t, tCode } from '../i18n';

const KINDS: { kind: string; title: string; description: string }[] = [
  { kind: 'roster', title: 'Duty roster', description: 'Personnel × duties in the period.' },
  { kind: 'assignments', title: 'Duty assignments', description: 'Every assignment with personnel, supervisor and open exceptions.' },
  { kind: 'completion', title: 'Duty completion', description: 'Per category: completed, cancelled, open and check-in outcomes.' },
  { kind: 'exceptions', title: 'Exceptions', description: 'Raised exceptions with status, notes and resolution.' },
  { kind: 'evidence-verification', title: 'Evidence verification', description: 'Evidence integrity status per item (hash prefix only).' },
];

export function ReportsPage() {
  const { can } = useAuth();
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  const [category, setCategory] = useState('');
  const [unitId, setUnitId] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const filters = { from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59`).toISOString(), category, unitId };
  const sum = useApi(
    () => api<{ reports: Record<string, { title: string; rows: number }> }>(`/api/v1/reports/summary${qs(filters)}`),
    [from, to, category, unitId],
  );
  return (
    <>
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />
      <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-paper-200 bg-white p-3 md:grid-cols-4">
        <Field label={t('common.from')}>
          <input type="date" className="input w-full" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('common.to')}>
          <input type="date" className="input w-full" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t('duty.category')}>
          <select className="input w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t('common.all')}</option>
            {(['TRAIN_BEAT', 'STATION_WATCH', 'VIP_ESCORT', 'TRACK_INCIDENT'] as const).map((c) => (
              <option key={c} value={c}>
                {tCode('category', c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('duty.unit')}>
          <UnitSelect value={unitId} onChange={setUnitId} />
        </Field>
      </div>
      {notice && <Notice tone={notice.ok ? 'ok' : 'bad'}>{notice.text}</Notice>}
      {sum.loading && !sum.data && <LoadingState />}
      {sum.error ? <ErrorState error={sum.error} onRetry={sum.reload} /> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {KINDS.map((k) => (
          <Card key={k.kind} title={k.title}>
            <p className="text-sm text-ink-800">{k.description}</p>
            <p className="mt-2 text-sm">
              <span className="text-2xl font-semibold tabular-nums">{sum.data?.reports[k.kind]?.rows ?? '…'}</span> row(s) for these filters
            </p>
            {can('reports.export') ? (
              <div className="mt-3 flex gap-2">
                {(['csv', 'pdf'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    className="btn-secondary"
                    onClick={() =>
                      download(`/api/v1/reports/${k.kind}.${fmt}${qs(filters)}`, `pramaan-${k.kind}.${fmt}`)
                        .then(() => setNotice({ ok: true, text: `${k.title} exported as ${fmt.toUpperCase()} (recorded in the audit trail).` }))
                        .catch((e) => setNotice({ ok: false, text: errorText(e) }))
                    }
                  >
                    {t('common.download')} {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-ink-700">Exporting requires reports.export.</p>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
