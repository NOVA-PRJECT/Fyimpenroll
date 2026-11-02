import { useCallback, useEffect, useRef, useState } from 'react';

/** Only a pull gesture owns the native spinner; query refetches can also belong to actions. */
export function usePullToRefresh(load: () => Promise<unknown>, disabled = false) {
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const onRefresh = useCallback(async () => {
    if (disabled || busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try { await load(); }
    catch { /* The query exposes the error and retry UI; native gestures cannot consume a rejected promise. */ }
    finally {
      busy.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, [disabled, load]);

  return { refreshing, onRefresh, refreshDisabled: disabled || refreshing, isRefreshing: () => busy.current };
}
