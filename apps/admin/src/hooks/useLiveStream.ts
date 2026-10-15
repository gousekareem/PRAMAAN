import { useEffect, useRef, useState } from 'react';
import { config } from '../services/config';
import { useAuth } from '../auth/AuthContext';

export type StreamState = 'connecting' | 'connected' | 'disconnected';

/**
 * Subscribes to /api/v1/dashboard/stream via fetch streaming (keeps the bearer token out of
 * URLs). Events trigger refetches; the stream only says "something changed".
 */
export function useLiveStream(
  onEvent: (type: string, data: unknown) => void,
  enabled = true,
): StreamState {
  const { getToken, status } = useAuth();
  const [state, setState] = useState<StreamState>('connecting');
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!enabled || status !== 'authenticated' || typeof ReadableStream === 'undefined') return;
    const ctrl = new AbortController();
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      setState('connecting');
      try {
        const res = await fetch(`${config.apiBaseUrl}/api/v1/dashboard/stream`, {
          headers: { Authorization: `Bearer ${getToken() ?? ''}` },
          signal: ctrl.signal,
          credentials: 'include',
        });
        if (!res.ok || !res.body) throw new Error('stream failed');
        setState('connected');
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const type = /^event: (.+)$/m.exec(chunk)?.[1];
            const data = /^data: (.+)$/m.exec(chunk)?.[1];
            if (type && data) {
              try {
                handler.current(type, JSON.parse(data));
              } catch {
                /* ignore malformed */
              }
            }
          }
        }
      } catch {
        /* reconnect below */
      }
      if (!stopped) {
        setState('disconnected');
        retry = setTimeout(() => void connect(), 10_000);
      }
    };
    void connect();
    return () => {
      stopped = true;
      ctrl.abort();
      if (retry) clearTimeout(retry);
    };
  }, [status, getToken, enabled]);
  return state;
}
