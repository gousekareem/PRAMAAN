import { useState } from 'react';
import { api, errorText, send } from '../services/api';
import { useApi } from '../hooks/useApi';
import { formatTime } from '../components/ui/Misc';

interface Detail {
  notes: { id: string; note: string; createdAt: string; authorName: string; authorRole: string }[];
  history: { sequence: number; occurredAt: string; action: string; actorName: string | null; details: Record<string, unknown> }[];
}

/** Investigation notes (append-only) and the audited action history of one exception. */
export function ExceptionNotes({ flagId, canAdd, onChange }: { flagId: string; canAdd: boolean; onChange: () => void }) {
  const d = useApi(() => api<Detail>(`/api/v1/exceptions/${flagId}`), [flagId]);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-2 grid gap-3 rounded border border-paper-200 p-3 text-sm md:grid-cols-2">
      <div>
        <p className="font-semibold">Investigation notes</p>
        {d.data && !d.data.notes.length && <p className="text-ink-700">No notes yet.</p>}
        <ul className="mt-1 space-y-1">
          {d.data?.notes.map((n) => (
            <li key={n.id}>
              <p className="whitespace-pre-wrap">{n.note}</p>
              <p className="text-xs text-ink-700">
                {n.authorName} ({n.authorRole}) · {formatTime(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
        {canAdd && (
          <form
            className="mt-2"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await send(`/api/v1/exceptions/${flagId}/notes`, 'POST', { note });
                setNote('');
                setErr(null);
                await d.reload();
                onChange();
              } catch (x) {
                setErr(errorText(x));
              }
            }}
          >
            <label className="block text-xs font-medium text-ink-900">
              Add note
              <textarea className="input mt-1 h-16 w-full" value={note} minLength={3} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            </label>
            {err && <p className="text-xs text-signal-bad">{err}</p>}
            <button type="submit" className="btn-secondary mt-1" disabled={note.trim().length < 3}>
              Save note
            </button>
          </form>
        )}
      </div>
      <div>
        <p className="font-semibold">Action history (audit trail)</p>
        {d.data && !d.data.history.length && <p className="text-ink-700">No actions yet.</p>}
        <ul className="mt-1 space-y-1 text-xs">
          {d.data?.history.map((h) => (
            <li key={h.sequence}>
              #{h.sequence} {h.action.replace(/^FLAG_/, '').replace(/_/g, ' ').toLowerCase()} by {h.actorName ?? 'system'} · {formatTime(h.occurredAt)}
              {typeof h.details.note === 'string' && h.details.note ? ` — ${h.details.note}` : ''}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
