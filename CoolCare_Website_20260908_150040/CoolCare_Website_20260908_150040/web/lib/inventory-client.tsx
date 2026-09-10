'use client';
import { createContext, useContext, useEffect, useState } from 'react';
export const ROOT = '/admin/inventory';
export type Part = {
  part_id: number;
  part_name: string;
  unit_price: number;
  status: 'Active' | 'Inactive' | 'Discontinued';
  current_stock: number;
  stock_value: number;
};
export type Transaction = {
  transaction_id: number;
  part_id: number;
  part_name: string;
  transaction_type: string;
  quantity: number;
  stock_delta: number | null;
  stock_before: number | null;
  stock_after: number | null;
  job_id: number | null;
  admin_name: string | null;
  remarks: string | null;
  created_at: string;
};
export type List<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};
export type User = { user_id: number; full_name: string; email: string };
export type Options = {
  parts: Part[];
  jobs: { job_id: number; current_status: string }[];
};
export const AppContext = createContext<{
  user: User;
  url: string;
  go: (url: string, force?: boolean) => void;
  setDirty: (v: boolean) => void;
  notify: (text: string) => void;
  version: number;
  threshold: number;
  refresh: () => void;
} | null>(null);
export function useInventory() {
  const context = useContext(AppContext);
  if (!context) throw new Error('Missing inventory context');
  return context;
}
let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/login')
      window.dispatchEvent(new Event('coolcare:unauthorized'));
    const message =
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof data.error === 'string'
        ? data.error
        : 'Request failed.';
    throw new ApiError(message, response.status);
  }
  return data as T;
}
export function useResource<T>(endpoint: string | null, version = 0) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!endpoint) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);
    api<T>(endpoint, 'GET', undefined, controller.signal)
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e.message || 'Unable to connect. Check the local server.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, version, retry]);
  return { data, loading, error, reload: () => setRetry((n) => n + 1) };
}
export function money(n: unknown) {
  return (
    '$' +
    Number(n || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
export function code(prefix: string, id: number) {
  return prefix + '-' + String(id).padStart(4, '0');
}
export function stockSign(n: number | null) {
  return n === null
    ? 'Not recorded'
    : `${n > 0 ? '+' : ''}${n.toLocaleString()}`;
}
export function safeBack(params: URLSearchParams, fallback = ROOT + '/parts') {
  const back = params.get('back');
  return back && back.startsWith(ROOT) && !back.includes('://')
    ? back
    : fallback;
}
export function errorText(e: unknown) {
  return e instanceof Error ? e.message : 'Unable to save. Please try again.';
}
