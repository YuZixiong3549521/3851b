'use client';

import { useEffect, useState } from 'react';
import { Download, Filter, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { LoadState, Pager } from '@/components/inventory-ui';
import { useInventory, useResource, type List } from '@/lib/inventory-client';
import { formatInstantDateTime } from '@/lib/sg-time';
import { auditActions, auditCategories, auditFilterKeys } from '@/lib/admin-audit-filters.mjs';

type Filters = { bookingId: string; category: string; action: string; actorId: string; from: string; to: string; q: string; sort: string; pageSize: string };
type Actor = { id: number; name: string; role: string; accessLevel: string | null; status: string };
type AuditRow = {
  requestId: string; bookingId: number; bookingReference: string; action: string; category: string;
  createdAt: string; actor: string; actorId: number; actorRole: string; actorAccessLevel: string | null;
  customerName: string; customerEmail: string; outcome: { label: string; value: string }[];
};
const readFilters = (params: URLSearchParams): Filters => ({
  bookingId: params.get('bookingId') || '', category: params.get('category') || '', action: params.get('action') || '',
  actorId: params.get('actorId') || '', from: params.get('from') || '', to: params.get('to') || '', q: params.get('q') || '',
  sort: params.get('sort') || 'newest', pageSize: params.get('pageSize') || '25',
});

export function AdminAuditPage({ params }: { params: URLSearchParams }) {
  const { version, refresh, user, go } = useInventory();
  const urlKey = params.toString();
  const [filters, setFilters] = useState<Filters>(() => readFilters(params));
  const [validation, setValidation] = useState('');
  const [actors, setActors] = useState<Actor[]>([]);
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  useEffect(() => { setFilters(readFilters(new URLSearchParams(urlKey))); setValidation(''); setExportError(''); }, [urlKey]);
  const query = new URLSearchParams();
  for (const key of [...auditFilterKeys, 'page']) if (params.get(key)) query.set(key, params.get(key)!);
  const resource = useResource<List<AuditRow> & { actors: Actor[] }>(`/admin/audit?${query}`, version);
  useEffect(() => { if (resource.data) setActors(resource.data.actors); }, [resource.data]);
  const update = (key: keyof Filters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const choices = filters.category ? auditCategories.find(category => category.value === filters.category)?.actions ?? [] : auditActions;
  const apply = () => {
    if (filters.from && filters.to && filters.from > filters.to) { setValidation('The end date must not precede the start date.'); return; }
    const next = new URLSearchParams();
    for (const key of auditFilterKeys as (keyof Filters)[]) if (filters[key].trim()) next.set(key, filters[key].trim());
    setValidation(''); setExportError('');
    if (next.toString() === query.toString()) refresh(); else go(`/admin/audit?${next}`);
  };
  const pageTo = (page: number) => { const next = new URLSearchParams(query); next.set('page', String(page)); go(`/admin/audit?${next}`); };
  async function download() {
    setExportError(''); setExporting(true);
    try {
      const response = await fetch(`/api/admin/audit/export?${query}`);
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error || 'Unable to export operations.'); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'coolcare-operations-filtered.csv'; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { setExportError(error instanceof Error ? error.message : 'Unable to export operations.'); }
    finally { setExporting(false); }
  }
  return <>
    <div className="page-title">
      <div><p className="eyebrow">ADMIN / AUDIT</p><h1>Booking operation log</h1>
        <p className="muted">Find successful booking changes by administrator, action, customer and time. Open a record to inspect its saved outcome.</p>
      </div>
      <Button variant="outline" onClick={refresh} disabled={resource.loading}><RefreshCw />Refresh</Button>
    </div>
    <form className="panel mb-5 space-y-4" onSubmit={event => { event.preventDefault(); apply(); }}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-1 text-sm" htmlFor="audit-booking-filter">Booking reference
          <Input id="audit-booking-filter" value={filters.bookingId} onChange={event => update('bookingId', event.target.value)} placeholder="BK-2026-0001 or booking ID" maxLength={40} />
        </label>
        <label className="space-y-1 text-sm" htmlFor="audit-category-filter">Category
          <NativeSelect id="audit-category-filter" value={filters.category} onChange={event => setFilters(current => ({ ...current, category: event.target.value, action: '' }))}>
            <option value="">All categories</option>{auditCategories.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm" htmlFor="audit-action-filter">Action
          <NativeSelect id="audit-action-filter" value={filters.action} onChange={event => update('action', event.target.value)}>
            <option value="">All actions</option>{choices.map(action => <option key={action} value={action}>{action}</option>)}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm" htmlFor="audit-actor-filter">Administrator
          <NativeSelect id="audit-actor-filter" value={filters.actorId} onChange={event => update('actorId', event.target.value)}>
            <option value="">All administrators</option>{actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name} · {actor.accessLevel || actor.role}{actor.status === 'Active' ? '' : ` · ${actor.status}`}</option>)}
          </NativeSelect>
        </label>
        <div className="space-y-1 text-sm"><p>From date (SGT)</p><EnglishDatePicker label="Operation log start date" value={filters.from} onChange={value => update('from', value)} disableWeekends={false} max={filters.to || undefined} /></div>
        <div className="space-y-1 text-sm"><p>To date (SGT, inclusive)</p><EnglishDatePicker label="Operation log end date" value={filters.to} onChange={value => update('to', value)} disableWeekends={false} min={filters.from || undefined} /></div>
        <label className="space-y-1 text-sm sm:col-span-2" htmlFor="audit-text-filter">Search details
          <Input id="audit-text-filter" value={filters.q} onChange={event => update('q', event.target.value)} maxLength={120} placeholder="Customer, administrator, recorded reason or request ID" />
        </label>
        <label className="space-y-1 text-sm" htmlFor="audit-sort-filter">Order by
          <NativeSelect id="audit-sort-filter" value={filters.sort} onChange={event => update('sort', event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></NativeSelect>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={resource.loading}><Filter className="size-4" />Apply filters</Button>
        <Button type="button" variant="outline" onClick={() => { setFilters(readFilters(new URLSearchParams())); setValidation(''); setExportError(''); go('/admin/audit'); }}><RotateCcw className="size-4" />Reset filters</Button>
        {user.access_level === 'Owner' && <Button type="button" variant="outline" onClick={() => void download()} disabled={resource.loading || exporting || !resource.data?.total}><Download className="size-4" />{exporting ? 'Exporting…' : 'Export filtered results (CSV)'}</Button>}
      </div>
      <p className="text-xs text-muted-foreground">Dates cover whole Singapore calendar days. Search uses stored operation results, not later changes to the booking. Administrator roles and customer details show their current account values. CSV exports all matching results, up to 10,000 records.</p>
      {(validation || exportError) && <p role="alert" className="text-sm text-destructive">{validation || exportError}</p>}
    </form>
    <LoadState {...resource} />
    {resource.data && <section className="panel">
      <p className="mb-4 text-sm text-muted-foreground" role="status">{resource.data.total} matching operation{resource.data.total === 1 ? '' : 's'} · {(query.get('sort') || 'newest') === 'newest' ? 'Newest first' : 'Oldest first'}{query.get('from') || query.get('to') ? ` · ${query.get('from') || 'Earliest'} to ${query.get('to') || 'Latest'} (SGT)` : ' · All dates'}</p>
      <div className="grid gap-3">{resource.data.rows.map(row => <article key={row.requestId} className="min-w-0 space-y-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted-foreground">{row.category}</p><strong>{row.action}</strong><p className="mt-1 text-sm">{formatInstantDateTime(row.createdAt)}</p></div>
          <Button variant="outline" onClick={() => go(`/admin/orders/${row.bookingId}`)}>{row.bookingReference}</Button>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Administrator</p><p>{row.actor}</p><p className="text-xs text-muted-foreground">{row.actorAccessLevel || row.actorRole} (current role)</p></div><div><p className="text-xs text-muted-foreground">Customer</p><p>{row.customerName}</p><p className="break-all text-xs text-muted-foreground">{row.customerEmail}</p></div></div>
        <details className="rounded-lg bg-muted/40 p-3"><summary className="cursor-pointer text-sm font-medium">Recorded outcome</summary>
          {row.outcome.length ? <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{row.outcome.map(item => <div key={item.label} className="min-w-0"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{item.value}</dd></div>)}</dl> : <p className="mt-3 text-sm text-muted-foreground">No additional outcome fields were stored for this operation.</p>}
          <p className="mt-3 text-xs text-muted-foreground">These are the original saved results. Previous values are not stored in this log. Open the booking for timeline notes.</p>
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">Request ID: {row.requestId}</p>
        </details>
      </article>)}</div>
      {!resource.data.rows.length && <div className="py-8 text-center"><p className="font-medium">No matching operations</p><p className="mt-1 text-sm text-muted-foreground">Try a wider date range, another administrator or fewer filters.</p></div>}
      <Pager {...resource.data} onPage={pageTo} onSize={size => { const next = new URLSearchParams(query); next.set('pageSize', String(size)); next.delete('page'); go(`/admin/audit?${next}`); }} />
    </section>}
  </>;
}
