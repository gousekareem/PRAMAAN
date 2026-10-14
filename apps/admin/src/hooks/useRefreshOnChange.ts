import { useEffect } from 'react';

/** Re-runs `reload` (debounced) when the server stream reports new data. */
export function useRefreshOnChange(reload: () => unknown, delayMs = 1500): void {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const fn = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void reload(), delayMs);
    };
    window.addEventListener('pramaan:changed', fn);
    return () => {
      window.removeEventListener('pramaan:changed', fn);
      if (t) clearTimeout(t);
    };
  }, [reload, delayMs]);
}
