/**
 * Loads something from the API and keeps the three states a screen actually has:
 * loading, failed with a readable reason, and loaded.
 *
 * Every list screen needs the same thing, and writing it out each time is how
 * one screen ends up silently swallowing its error while another shows a spinner
 * forever. `reload` is exposed so a screen can refresh after a write without
 * remounting, and `silentReload` so a live update can refresh underneath the
 * operator without flashing the whole page back to a spinner.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** True when the failure was a refusal rather than a fault, so the screen can say so. */
  denied: boolean;
  reload: () => Promise<void>;
  silentReload: () => Promise<void>;
  setData: (next: T) => void;
}

export function useResource<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
  options: { enabled?: boolean } = {}
): Resource<T> {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  // Guards against a slow response landing after the screen moved on, which
  // would otherwise repopulate a filter the operator has already changed.
  const requestId = useRef(0);

  const run = useCallback(
    async (showSpinner: boolean) => {
      if (!enabled) return;
      const id = ++requestId.current;
      if (showSpinner) setLoading(true);
      try {
        const result = await loaderRef.current();
        if (id !== requestId.current) return;
        setData(result);
        setError(null);
        setDenied(false);
      } catch (err: any) {
        if (id !== requestId.current) return;
        setDenied(err instanceof ApiError && err.isPermissionDenied);
        setError(err?.message || 'Could not reach the Quick Bites server.');
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [enabled]
  );

  useEffect(() => {
    void run(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return {
    data,
    loading,
    error,
    denied,
    reload: () => run(true),
    silentReload: () => run(false),
    setData: (next: T) => setData(next)
  };
}
