'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Refresh persisted customer data on return to the page and while it stays visible. */
export function useCustomerResource<T>(load: () => Promise<T>) {
  // Keep data tied to the loader that produced it. Route changes must never
  // render another booking's data, even before the next effect has run.
  const [resource, setResource] = useState<{ source: typeof load; data: T | null; error: string; refreshing: boolean }>(() => ({ source: load, data: null, error: '', refreshing: false }));
  const currentLoad = useRef(load);
  currentLoad.current = load;
  const request = useRef(0);
  const mounted = useRef(false);
  const pending = useRef(false);

  const refresh = useCallback(async () => {
    // An old action may finish after navigation and call its captured refresh.
    // Reject it before it can invalidate the new route's in-flight request.
    if (!mounted.current || currentLoad.current !== load) return;
    const sequence = ++request.current;
    pending.current = true;
    setResource(previous => previous.source === load ? { ...previous, refreshing: true } : { source: load, data: null, error: '', refreshing: true });
    try {
      const result = await load();
      if (mounted.current && currentLoad.current === load && sequence === request.current) setResource({ source: load, data: result, error: '', refreshing: false });
    } catch (reason) {
      if (mounted.current && currentLoad.current === load && sequence === request.current) {
        const status = (reason as { status?: number })?.status;
        const clearData = status === 401 || status === 403 || status === 404;
        setResource(previous => ({ source: load, data: !clearData && previous.source === load ? previous.data : null, error: reason instanceof Error ? reason.message : 'Unable to refresh your information. Please retry.', refreshing: false }));
        if (status === 401) window.location.assign(new URLSearchParams(window.location.search).get('assistant') === 'resume'
          ? '/#/login?returnTo=assistant' : '/#/login');
      }
    } finally {
      if (currentLoad.current === load && sequence === request.current) {
        pending.current = false;
        if (mounted.current) setResource(previous => previous.source === load ? { ...previous, refreshing: false } : previous);
      }
    }
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onReturn = () => { if (document.visibilityState === 'visible' && !pending.current) void refresh(); };
    // A completed mutation must supersede any read started before it finished.
    const onBookingsUpdated = () => { void refresh(); };
    window.addEventListener('focus', onReturn);
    window.addEventListener('online', onReturn);
    window.addEventListener('coolcare:bookings-updated', onBookingsUpdated);
    document.addEventListener('visibilitychange', onReturn);
    const interval = window.setInterval(onReturn, 60_000);
    return () => {
      mounted.current = false;
      request.current += 1;
      pending.current = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('online', onReturn);
      window.removeEventListener('coolcare:bookings-updated', onBookingsUpdated);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [refresh]);
  const current = resource.source === load;
  return { data: current ? resource.data : null, error: current ? resource.error : '', refreshing: current ? resource.refreshing : true, refresh };
}
