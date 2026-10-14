import { useEffect, useRef, useState, type ReactNode } from 'react';

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function relativeAge(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'under a minute ago';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** Labels the source of a timestamp; device times are never presented as authoritative. */
export function TimeText({
  iso,
  source,
}: {
  iso: string | null | undefined;
  source: 'device' | 'trusted-estimate' | 'server';
}) {
  const label =
    source === 'device'
      ? 'device clock'
      : source === 'trusted-estimate'
        ? 'anchored estimate'
        : 'server';
  return (
    <span>
      <time dateTime={iso ?? undefined}>{formatTime(iso)}</time>{' '}
      <span className="text-xs text-ink-600">({label})</span>
    </span>
  );
}

export function HashText({
  value,
  short = false,
}: {
  value: string | null | undefined;
  short?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-ink-600">—</span>;
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <code className="break-all font-mono text-xs text-ink-900" title={value}>
        {short ? `${value.slice(0, 12)}…${value.slice(-6)}` : value}
      </code>
      <button
        type="button"
        aria-label="Copy hash"
        onClick={() =>
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          })
        }
        className="rounded px-1 text-xs text-ink-600 hover:bg-paper-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-600"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-paper-200 pb-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-950">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-700">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  return (
    <nav
      aria-label="Pagination"
      className="mt-3 flex items-center justify-between text-sm text-ink-700"
    >
      <span>
        {total} record{total === 1 ? '' : 's'} · page {page} of {totalPages}
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </span>
    </nav>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  requireNote,
  onConfirm,
  onCancel,
  extra,
  confirmDisabled,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  requireNote?: boolean;
  extra?: ReactNode;
  confirmDisabled?: boolean;
  onConfirm: (note: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setNote('');
      d.showModal?.();
      if (!d.showModal) d.setAttribute('open', '');
    }
    if (!open && d.open) {
      d.close?.();
      d.removeAttribute('open');
    }
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={onCancel}
      className="w-[min(92vw,30rem)] rounded-lg p-0 shadow-xl backdrop:bg-ink-950/40"
    >
      <form
        method="dialog"
        className="p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onConfirm(note);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="confirm-title" className="text-base font-semibold text-ink-950">
          {title}
        </h2>
        <p className="mt-2 text-sm text-ink-800">{body}</p>
        {requireNote && (
          <label className="mt-3 block text-sm font-medium text-ink-900">
            Review note (required)
            <textarea
              required
              minLength={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="input mt-1 h-24 w-full"
            />
          </label>
        )}
        {extra}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || confirmDisabled || (requireNote && note.trim().length < 3)}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function Card({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-paper-200 bg-white p-4 shadow-sm ${className}`}>
      {title && (
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-700">{title}</h2>
      )}
      {children}
    </section>
  );
}

export function KV({
  k,
  children,
  stacked = false,
}: {
  k: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-0.5 border-b border-paper-100 py-1.5 text-sm ${stacked ? '' : 'sm:grid-cols-[13rem_1fr]'}`}
    >
      <dt className="text-ink-700">{k}</dt>
      <dd className="min-w-0 text-ink-950">{children}</dd>
    </div>
  );
}
