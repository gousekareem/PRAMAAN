import { ApiError } from '../../services/api';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 p-6 text-sm text-ink-700"
    >
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-ink-600 border-t-transparent"
        aria-hidden
      />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded border border-dashed border-paper-200 bg-white p-8 text-center">
      <p className="font-medium text-ink-900">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-700">{hint}</p>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className="rounded border border-signal-bad/30 bg-red-50 p-4 text-sm">
      <p className="font-semibold text-signal-bad">
        {e?.code === 'NETWORK_ERROR' ? 'Server unreachable' : 'Request failed'}
      </p>
      <p className="mt-1 text-ink-800">{e?.message ?? 'An unexpected error occurred.'}</p>
      {e?.requestId && (
        <p className="mt-1 font-mono text-xs text-ink-700">Request ID: {e.requestId}</p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded border border-ink-700 px-3 py-1 text-ink-900 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-600"
        >
          Try again
        </button>
      )}
    </div>
  );
}
