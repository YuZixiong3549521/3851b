'use client';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { PackageSearch, RefreshCw, Download, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/components/ui/pagination';
import { useInventory, ROOT, errorText } from '@/lib/inventory-client';

export function Choice({
  value,
  onChange,
  options,
  label,
  id,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v !== null && onChange(String(v))}
      items={options}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export const choices = (values: string[]) =>
  values.map((value) => ({ value, label: value }));
export function Status({ value }: { value: string }) {
  return (
    <span
      className={
        'status ' +
        (value === 'Active' || value === 'Stock In' || value === 'Return'
          ? 'good'
          : value === 'Discontinued' || value === 'Stock Out'
            ? 'dim'
            : 'warning')
      }
    >
      {value}
    </span>
  );
}
export function PageTitle({
  title,
  subtitle,
  actions,
  crumb,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  crumb?: string;
}) {
  const { go } = useInventory();
  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <button onClick={() => go(ROOT)}>Inventory</button>
        {crumb && (
          <>
            <ChevronRight size={13} />
            <button onClick={() => go(ROOT + '/parts')}>Parts</button>
          </>
        )}
        <ChevronRight size={13} />
        <span>{crumb || title}</span>
      </nav>
      <div className="page-title">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <div className="actions">{actions}</div>
      </div>
    </>
  );
}
export function LoadState({
  loading,
  error,
  reload,
}: {
  loading: boolean;
  error: string;
  reload: () => void;
}) {
  if (error)
    return (
      <section className="panel error-state" role="alert">
        <h2>Could not load inventory</h2>
        <p>{error}</p>
        <Button variant="outline" onClick={reload}>
          <RefreshCw />
          Retry
        </Button>
      </section>
    );
  if (loading)
    return (
      <section
        className="panel"
        aria-label="Loading inventory"
        aria-busy="true"
      >
        <Skeleton className="h-7 w-52 mb-6" />
        {[1, 2, 3].map((n) => (
          <Skeleton key={n} className="h-12 w-full mb-3" />
        ))}
      </section>
    );
  return null;
}
export function NoResults({
  title = 'No matching records',
  description = 'Change or clear your filters to see more results.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Empty className="empty-state">
      <PackageSearch />
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
      {action}
    </Empty>
  );
}
export function Pager({
  total,
  page,
  pageSize,
  onPage,
  onSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onSize?: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span>
        {total ? (page - 1) * pageSize + 1 : 0}–
        {Math.min(page * pageSize, total)} of {total} records
      </span>
      {onSize && (
        <Choice
          label="Rows per page"
          value={String(pageSize)}
          onChange={(v) => onSize(Number(v))}
          options={[10, 25, 50].map((n) => ({
            value: String(n),
            label: `${n} / page`,
          }))}
        />
      )}
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
            >
              Previous
            </Button>
          </PaginationItem>
          <PaginationItem>
            <span className="page-number">
              {page} / {pages}
            </span>
          </PaginationItem>
          <PaginationItem>
            <Button
              variant="outline"
              disabled={page >= pages}
              onClick={() => onPage(page + 1)}
            >
              Next
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
export function ExportButton({
  endpoint,
  filename,
}: {
  endpoint: string;
  filename: string;
}) {
  const [busy, setBusy] = useState(false);
  const { notify } = useInventory();
  async function download() {
    setBusy(true);
    try {
      const response = await fetch('/api' + endpoint, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(
          data &&
            typeof data === 'object' &&
            'error' in data &&
            typeof data.error === 'string'
            ? data.error
            : 'Export failed.',
        );
      }
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      notify('CSV exported.');
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" disabled={busy} onClick={download}>
      <Download />
      {busy ? 'Exporting…' : 'Export CSV'}
    </Button>
  );
}
