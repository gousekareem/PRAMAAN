import { useEffect, useState } from 'react';
import { rawRequest, ApiError } from '../services/api';

/** Fetches the image with the bearer token; object URL is revoked on unmount. */
export function EvidenceImage({ evidenceId }: { evidenceId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    rawRequest(`/api/v1/evidence/${evidenceId}/content`)
      .then((r) => r.blob())
      .then((b) => {
        if (!cancelled) {
          objectUrl = URL.createObjectURL(b);
          setUrl(objectUrl);
        }
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Image unavailable'));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [evidenceId, shown]);
  if (!shown)
    return (
      <button type="button" className="btn-secondary" onClick={() => setShown(true)}>
        Show evidence image (access is audited)
      </button>
    );
  if (error)
    return (
      <p role="alert" className="text-sm text-signal-bad">
        {error}
      </p>
    );
  if (!url) return <p className="text-sm text-ink-700">Loading and re-verifying image…</p>;
  return (
    <img
      src={url}
      alt="Evidence capture (server re-verified SHA-256 before display)"
      className="max-h-[420px] w-full rounded border border-paper-200 object-contain"
    />
  );
}
