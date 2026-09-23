'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLoginHref, getPortalHome, LOGIN_PATH, notifySessionChange, readPortalSession, SESSION_CHANNEL } from './portal-session.mjs';

export type PortalUser = {
  id: number;
  name: string;
  role: 'Customer' | 'Technician' | 'Admin';
  email: string;
  phone?: string;
  propertyType?: string;
  accessLevel?: 'Owner' | 'Admin';
};

export function usePortalSession(requiredRole?: PortalUser['role']) {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const identity = useRef<string | null>(null);
  const revision = useRef(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const acceptLogin = useCallback((current: PortalUser) => {
    revision.current += 1;
    identity.current = `${current.role}:${current.id}`;
    setUser(current);
    setReady(true);
    setError('');
    setAttempt(value => value + 1);
    notifySessionChange('session-changed');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let ended = false;
    const clear = () => { setUser(null); setReady(false); };
    const signOut = () => {
      revision.current += 1;
      ended = true;
      clear();
      if (requiredRole) window.location.replace(LOGIN_PATH);
      else { identity.current = null; setReady(true); setAttempt(value => value + 1); }
    };
    async function refresh() {
      if (pending || ended || controller.signal.aborted) return;
      pending = true;
      const startedAt = revision.current;
      try {
        const current: PortalUser | null = await readPortalSession(controller.signal);
        if (ended || controller.signal.aborted || startedAt !== revision.current) return;
        if (requiredRole && (!current || current.role !== requiredRole)) {
          ended = true;
          clear();
          window.location.replace(current ? getPortalHome(current.role) : getLoginHref(window.location.pathname + window.location.search + window.location.hash));
          return;
        }
        const nextIdentity = current ? `${current.role}:${current.id}` : null;
        if (identity.current && identity.current !== nextIdentity) {
          ended = true;
          clear();
          window.location.reload();
          return;
        }
        identity.current = nextIdentity;
        setUser(current);
        setReady(true);
        setError('');
      } catch (reason) {
        if (!ended && !controller.signal.aborted && startedAt === revision.current) {
          setError(reason instanceof Error ? reason.message : 'Unable to check your session. Please retry.');
          setReady(true);
        }
      } finally { pending = false; }
    }
    const visibleRefresh = () => { if (document.visibilityState === 'visible') void refresh(); };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) { ended = false; clear(); void refresh(); }
    };
    let channel: BroadcastChannel | null = null;
    try { if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(SESSION_CHANNEL); } catch { /* Focus and periodic checks remain available. */ }
    if (channel) channel.onmessage = event => {
      if (event.data === 'signed-out') signOut();
      else if (event.data === 'session-changed') void refresh();
    };
    void refresh();
    const timer = window.setInterval(visibleRefresh, 30_000);
    window.addEventListener('focus', visibleRefresh);
    window.addEventListener('online', visibleRefresh);
    window.addEventListener('pageshow', restored);
    window.addEventListener('coolcare:profile-updated', visibleRefresh);
    window.addEventListener('coolcare:session-invalid', clear);
    window.addEventListener('coolcare:signed-out', signOut);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      controller.abort();
      channel?.close();
      window.clearInterval(timer);
      window.removeEventListener('focus', visibleRefresh);
      window.removeEventListener('online', visibleRefresh);
      window.removeEventListener('pageshow', restored);
      window.removeEventListener('coolcare:profile-updated', visibleRefresh);
      window.removeEventListener('coolcare:session-invalid', clear);
      window.removeEventListener('coolcare:signed-out', signOut);
      document.removeEventListener('visibilitychange', visibleRefresh);
    };
  }, [attempt, requiredRole]);

  return { user, ready, error, retry, acceptLogin };
}
