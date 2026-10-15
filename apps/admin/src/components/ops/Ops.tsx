import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../services/api';
import type { DutyCategory, DutyStatus, Unit } from '../../services/types';
import { Badge, type Tone } from '../ui/Badges';
import { t, tCode } from '../../i18n';

const dutyTone: Record<DutyStatus, Tone> = {
  DRAFT: 'muted',
  ASSIGNED: 'info',
  ACCEPTED: 'info',
  IN_PROGRESS: 'ok',
  COMPLETED: 'muted',
  EXCEPTION_REPORTED: 'warn',
  CANCELLED: 'muted',
};

export function DutyStatusBadge({ status }: { status: DutyStatus }) {
  return <Badge tone={dutyTone[status] ?? 'muted'}>{tCode('status', status)}</Badge>;
}

export const CATEGORY_STYLE: Record<DutyCategory, { dot: string; chip: string }> = {
  TRAIN_BEAT: { dot: 'bg-[#2c5a85]', chip: 'bg-[#e8eff7] text-[#1f4263] ring-[#2c5a85]/30' },
  STATION_WATCH: { dot: 'bg-[#1f7a4d]', chip: 'bg-[#e7f3ec] text-[#155c39] ring-[#1f7a4d]/30' },
  VIP_ESCORT: { dot: 'bg-[#6b4aa3]', chip: 'bg-[#f0ebf8] text-[#4f347e] ring-[#6b4aa3]/30' },
  TRACK_INCIDENT: { dot: 'bg-[#a8461f]', chip: 'bg-[#f8ece6] text-[#7f3416] ring-[#a8461f]/30' },
};

export function CategoryBadge({ category, restricted }: { category: DutyCategory; restricted?: boolean }) {
  const s = CATEGORY_STYLE[category];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {tCode('category', category)}
      {restricted && <span title={t('duty.restrictedHint')}> · restricted</span>}
    </span>
  );
}

export function ClassText({ cls }: { cls: string | null | undefined }) {
  return <span className="whitespace-nowrap">{tCode('class', cls ?? 'OTHER')}</span>;
}

export function RestrictedNotice() {
  return (
    <p role="note" className="rounded border border-[#6b4aa3]/30 bg-[#f6f2fb] p-3 text-sm text-[#4f347e]">
      <strong>{t('duty.restricted')}.</strong> {t('duty.restrictedHint')}
    </p>
  );
}

export function Disclaimer({ children }: { children: ReactNode }) {
  return <p className="mb-4 rounded border border-paper-200 bg-paper-100/60 p-3 text-xs leading-relaxed text-ink-800">{children}</p>;
}

export function Field({
  label,
  children,
  hint,
  className = '',
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`block text-sm font-medium text-ink-900 ${className}`}>
      {label}
      <div className="mt-1 font-normal">{children}</div>
      {hint && <span className="mt-0.5 block text-xs font-normal text-ink-600">{hint}</span>}
    </label>
  );
}

let unitCache: Promise<Unit[]> | null = null;
/** Organisational units (cached for the session). */
export function useUnits(): Unit[] {
  const [units, setUnits] = useState<Unit[]>([]);
  useEffect(() => {
    unitCache ??= api<{ items: Unit[] }>('/api/v1/units').then((r) => r.items).catch((e) => {
      unitCache = null;
      throw e;
    });
    unitCache.then(setUnits).catch(() => setUnits([]));
  }, []);
  return units;
}

export function resetUnitCache(): void {
  unitCache = null;
}

export function UnitSelect({
  value,
  onChange,
  allowAll = true,
  types,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  allowAll?: boolean;
  types?: Unit['unitType'][];
  id?: string;
}) {
  const units = useUnits().filter((u) => !types || types.includes(u.unitType));
  return (
    <select id={id} className="input w-full" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll ? (
        <option value="">{t('common.all')}</option>
      ) : (
        <option value="" disabled>
          Select…
        </option>
      )}
      {units.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
}

/** Formats a planned time range compactly (same-day ranges show the date once). */
export function TimeRange({ start, end }: { start: string; end: string }) {
  const s = new Date(start);
  const e = new Date(end);
  const d = (x: Date) => x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const h = (x: Date) => x.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const same = d(s) === d(e);
  return (
    <span className="whitespace-nowrap tabular-nums">
      {d(s)} {h(s)}–{same ? '' : `${d(e)} `}
      {h(e)}
    </span>
  );
}

/** Converts an ISO instant to the value format of <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string {
  return new Date(v).toISOString();
}

export function Notice({ tone, children }: { tone: 'ok' | 'bad' | 'warn'; children: ReactNode }) {
  const cls =
    tone === 'ok'
      ? 'border-signal-ok/30 bg-emerald-50 text-signal-ok'
      : tone === 'warn'
        ? 'border-signal-warn/30 bg-amber-50 text-signal-warn'
        : 'border-signal-bad/30 bg-red-50 text-signal-bad';
  return (
    <p role={tone === 'bad' ? 'alert' : 'status'} className={`mb-3 rounded border p-2 text-sm ${cls}`}>
      {children}
    </p>
  );
}

/**
 * Accessible modal that collects a mandatory text (reason, completion note, …) before an action.
 * Built on <dialog>; Escape cancels.
 */
export function TextActionDialog({
  open,
  title,
  body,
  label,
  confirmLabel,
  minLength = 5,
  optional = false,
  danger = false,
  children,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  label: string;
  confirmLabel: string;
  minLength?: number;
  optional?: boolean;
  danger?: boolean;
  children?: ReactNode;
  onConfirm: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setText('');
      setErr(null);
    }
  }, [open]);
  if (!open) return null;
  const ok = optional || text.trim().length >= minLength;
  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink-950/40 p-4" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby="ta-title" className="w-[min(94vw,32rem)] rounded-lg bg-white p-5 shadow-xl">
        <h2 id="ta-title" className="text-base font-semibold text-ink-950">
          {title}
        </h2>
        {body && <p className="mt-2 text-sm text-ink-800">{body}</p>}
        <form
          className="mt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              await onConfirm(text.trim());
            } catch (x) {
              setErr(x instanceof Error ? x.message : 'Request failed.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {children}
          <label className="mt-2 block text-sm font-medium text-ink-900">
            {label}
            {!optional && <span className="text-ink-600"> (required)</span>}
            <textarea autoFocus className="input mt-1 h-24 w-full" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
          </label>
          {err && (
            <p role="alert" className="mt-2 text-sm text-signal-bad">
              {err}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy || !ok}>
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
