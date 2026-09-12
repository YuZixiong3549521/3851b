'use client';

import { useEffect, useRef, useState } from 'react';
import { assistantApi, emptyAssistantDraft, sameAssistantDraft, verifyAssistantState, type AssistantDraft, type AssistantError, type AssistantState } from './assistant-api';

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict' | 'auth';
type PendingSave = { input: Parameters<typeof assistantApi.save>[0]; version: number };

/** Serializes saves and reconciles a lost PUT response before sending later edits. */
export function useAssistantDraft() {
  const [draft, setDraft] = useState<AssistantDraft>(emptyAssistantDraft);
  const [record, setRecord] = useState<AssistantState | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState('');
  const [version, setVersion] = useState(0);
  const draftRef = useRef(draft);
  const recordRef = useRef(record);
  const ownerRef = useRef<number | null>(null);
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const statusRef = useRef<SaveStatus>('idle');
  const pendingRef = useRef<PendingSave | null>(null);
  const savingRef = useRef<Promise<AssistantState | null> | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function status(next: SaveStatus) { statusRef.current = next; if (mounted.current) setSaveStatus(next); }
  function keepRecord(next: AssistantState | null) { recordRef.current = next; if (mounted.current) setRecord(next); }
  function hydrate(next: AssistantState | null, userId: number, fallback = emptyAssistantDraft) {
    verifyAssistantState(next, userId);
    ownerRef.current = userId;
    keepRecord(next);
    const value = next?.draft ?? fallback;
    draftRef.current = value; setDraft(value);
    versionRef.current = 0; savedVersionRef.current = 0; setVersion(0);
    pendingRef.current = null; setSaveError(''); status(next ? 'saved' : 'idle');
  }
  function update(patch: Partial<AssistantDraft>) {
    if (!ownerRef.current || ['conflict', 'auth'].includes(statusRef.current) || recordRef.current?.status === 'completed') return;
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next; setDraft(next);
    versionRef.current += 1; setVersion(versionRef.current);
    if (!['error', 'saving'].includes(statusRef.current)) status('dirty');
  }
  function fail(reason: unknown) {
    const error = reason as AssistantError;
    setSaveError(error.message || 'Your latest changes could not be saved. Retry before continuing.');
    status(error.status === 401 || error.status === 403 || error.code === 'ACCOUNT_CHANGED' ? 'auth' : error.code === 'DRAFT_CONFLICT' ? 'conflict' : 'error');
  }
  async function flush(retry = false): Promise<AssistantState | null> {
    if (savingRef.current) return savingRef.current;
    if (!ownerRef.current) return null;
    if (['conflict', 'auth'].includes(statusRef.current) || (statusRef.current === 'error' && !retry)) throw new Error(saveError || 'Reload or retry saving your draft before continuing.');
    const owner = ownerRef.current;
    const work = (async () => {
      try {
        if (pendingRef.current) {
          status('saving');
          const pending = pendingRef.current;
          const current = await assistantApi.load();
          verifyAssistantState(current, owner);
          if (current?.status === 'completed') { hydrate(current, owner); return current; }
          if (current && sameAssistantDraft(current.draft, pending.input.draft) && current.revision === pending.input.revision + 1 && (!pending.input.draftId || current.draftId === pending.input.draftId)) {
            keepRecord(current); savedVersionRef.current = pending.version; pendingRef.current = null;
          } else if ((!current && pending.input.draftId === null) || (current?.draftId === pending.input.draftId && current.revision === pending.input.revision)) {
            keepRecord(current); pendingRef.current = null;
          } else throw Object.assign(new Error('This draft changed in another session. Reload the saved draft to continue without overwriting it.'), { code: 'DRAFT_CONFLICT' });
        }
        while (savedVersionRef.current < versionRef.current) {
          status('saving');
          const pending: PendingSave = { input: { expectedUserId: owner, draftId: recordRef.current?.draftId ?? null, revision: recordRef.current?.revision ?? 0, draft: { ...draftRef.current } }, version: versionRef.current };
          pendingRef.current = pending;
          const next = await assistantApi.save(pending.input);
          verifyAssistantState(next, owner);
          if (ownerRef.current !== owner) throw Object.assign(new Error('The signed-in account changed. Reload your saved draft.'), { status: 401 });
          keepRecord(next); savedVersionRef.current = pending.version; pendingRef.current = null;
        }
        setSaveError(''); status(recordRef.current ? 'saved' : 'idle');
        return recordRef.current;
      } catch (reason) { fail(reason); throw reason; }
    })();
    savingRef.current = work;
    try { return await work; } finally { savingRef.current = null; }
  }

  useEffect(() => {
    if (!version || saveStatus !== 'dirty') return;
    const timer = window.setTimeout(() => { void flush().catch(() => undefined); }, 500);
    return () => window.clearTimeout(timer);
  }, [version, saveStatus]);
  useEffect(() => {
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      if (versionRef.current > savedVersionRef.current || pendingRef.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', protectUnsaved);
    return () => window.removeEventListener('beforeunload', protectUnsaved);
  }, []);
  return { draft, record, recordRef, draftRef, saveStatus, saveError, dirty: versionRef.current > savedVersionRef.current, hydrate, update, flush, fail, savingRef };
}
