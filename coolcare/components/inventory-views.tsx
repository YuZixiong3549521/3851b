'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  Edit3,
  Package,
  Plus,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Choice,
  choices,
  Status,
  PageTitle,
  LoadState,
  NoResults,
  Pager,
  ExportButton,
} from './inventory-ui';
import {
  ROOT,
  api,
  useInventory,
  useResource,
  money,
  code,
  stockSign,
  safeBack,
  errorText,
  ApiError,
  type Part,
  type Transaction,
  type List,
  type Options,
} from '@/lib/inventory-client';

function partPath(id: number, back?: string) {
  return `${ROOT}/parts/${id}${back ? '?back=' + encodeURIComponent(back) : ''}`;
}
function txPath(id?: number, type?: string) {
  const q = new URLSearchParams();
  if (id) q.set('part', String(id));
  if (type) q.set('type', type);
  return ROOT + '/transactions/new' + (q.size ? '?' + q : '');
}
function useFilters(params: URLSearchParams, base: string) {
  const { go } = useInventory();
  return (
    changes: Record<string, string | number | undefined>,
    resetPage = true,
  ) => {
    const next = new URLSearchParams(params);
    if (resetPage) next.delete('page');
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, String(value));
    }
    go(base + (next.size ? '?' + next : ''));
  };
}
export function Overview() {
  const { go, version, threshold } = useInventory();
  const result = useResource<{
    summary: {
      total_parts: number;
      total_units: number;
      stock_value: number;
      low_stock: number;
      out_of_stock: number;
    };
    parts: Part[];
    recent: Transaction[];
  }>('/overview', version);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const data = result.data;
  return (
    <>
      <PageTitle
        title="Inventory Overview"
        subtitle="An up-to-date view of your parts and stock."
        actions={
          <>
            <Button variant="outline" onClick={() => go(txPath())}>
              <ArrowLeftRight />
              Record Transaction
            </Button>
            <Button onClick={() => go(ROOT + '/parts/new')}>
              <Plus />
              Add Part
            </Button>
          </>
        }
      />
      <LoadState {...result} />
      {data && (
        <>
          <div className="stats">
            {[
              {
                label: 'TOTAL STOCK VALUE',
                value: money(data.summary.stock_value),
                note: 'Current units × unit price',
                icon: Wallet,
                target: ROOT + '/parts?sort=value&order=desc',
              },
              {
                label: 'TOTAL PARTS',
                value: data.summary.total_parts,
                note: 'Across all part statuses',
                icon: Package,
                target: ROOT + '/parts',
              },
              {
                label: 'LOW STOCK',
                value: data.summary.low_stock,
                note: `${threshold} units or fewer · includes zero`,
                icon: CircleAlert,
                target: ROOT + '/parts?stock=low',
              },
              {
                label: 'TOTAL UNITS',
                value: data.summary.total_units,
                note: `${data.summary.out_of_stock} parts out of stock`,
                icon: ArrowLeftRight,
                target: ROOT + '/parts?sort=stock&order=desc',
              },
            ].map(({ label, value, note, icon: Icon, target }) => (
              <Button variant="ghost"
                className="stat text-left"
                key={label}
                onClick={() => go(target)}
              >
                <span>
                  {label}
                  <Icon size={18} />
                </span>
                <strong>{value}</strong>
                <small>{note}</small>
              </Button>
            ))}
          </div>
          <div className="dashboard-grid">
            <section className="panel">
              <div className="panel-heading">
                <h2>Stock levels</h2>
                <span className="muted meta">Lowest stock first</span>
              </div>
              {data.parts.length ? (
                <div className="stock-chart">
                  {data.parts.map((p) => (
                    <Button variant="ghost"
                      key={p.part_id}
                      className="stock-bar-row"
                      onClick={() => go(partPath(p.part_id))}
                    >
                      <span>
                        {p.part_name}
                        <small>{code('PT', p.part_id)}</small>
                      </span>
                      <span className="bar-track">
                        <span
                          className={
                            p.current_stock <= threshold
                              ? 'bar-fill low'
                              : 'bar-fill'
                          }
                          style={{
                            width:
                              Math.max(
                                1,
                                (p.current_stock /
                                  Math.max(
                                    1,
                                    ...data.parts.map((x) => x.current_stock),
                                  )) *
                                  100,
                              ) + '%',
                          }}
                        />
                      </span>
                      <b>{p.current_stock}</b>
                    </Button>
                  ))}
                </div>
              ) : (
                <NoResults
                  title="No parts yet"
                  description="Add your first part to start tracking inventory."
                  action={
                    <Button onClick={() => go(ROOT + '/parts/new')}>
                      Add first part
                    </Button>
                  }
                />
              )}
              <p className="form-hint">
                Low-stock threshold: {threshold} units. Inventory values use the
                current unit price.
              </p>
            </section>
            <section className="panel attention-panel">
              <CircleAlert className="attention-icon" />
              <h2>Needs attention</h2>
              <p className="attention-total">
                {data.summary.low_stock}
                <span> low-stock parts</span>
              </p>
              {data.parts
                .filter((p) => p.current_stock <= threshold)
                .slice(0, 4)
                .map((p) => (
                  <Button variant="ghost"
                    className="attention-row"
                    key={p.part_id}
                    onClick={() => go(partPath(p.part_id))}
                  >
                    <span>{p.part_name}</span>
                    <b>{p.current_stock} left</b>
                  </Button>
                ))}
              {!data.summary.low_stock && (
                <p className="muted">
                  All parts are above the low-stock threshold.
                </p>
              )}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => go(ROOT + '/parts?stock=low')}
              >
                Review stock
                <ArrowRight />
              </Button>
            </section>
          </div>
          <section className="panel mt-6">
            <div className="panel-heading">
              <h2>Recent transactions</h2>
              <Button
                variant="ghost"
                onClick={() => go(ROOT + '/transactions')}
              >
                View all
                <ArrowRight />
              </Button>
            </div>
            <TransactionTable rows={data.recent} onSelect={setSelected} />
          </section>
        </>
      )}
      <TransactionDrawer
        transaction={selected}
        close={() => setSelected(null)}
      />
    </>
  );
}
export function PartsPage({ params }: { params: URLSearchParams }) {
  const { go, url, version, threshold } = useInventory();
  const result = useResource<List<Part>>('/parts?' + params, version);
  const update = useFilters(params, ROOT + '/parts');
  const [search, setSearch] = useState(params.get('q') || '');
  useEffect(() => setSearch(params.get('q') || ''), [params.toString()]);
  return (
    <>
      <PageTitle
        title="Parts Management"
        subtitle="Manage part details and keep stock traceable."
        actions={
          <>
            <ExportButton
              endpoint={'/parts/export?' + params}
              filename="coolcare-parts.csv"
            />
            <Button
              onClick={() =>
                go(ROOT + '/parts/new?back=' + encodeURIComponent(url))
              }
            >
              <Plus />
              Add Part
            </Button>
          </>
        }
      />
      <section className="panel table-panel">
        <div className="filters">
          <form
            className="search-control"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: search });
            }}
          >
            <Search />
            <Input
              aria-label="Search parts"
              placeholder="Search name or part ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={120}
            />
            <Button variant="secondary" type="submit">
              Search
            </Button>
          </form>
          <Choice
            label="Part status"
            value={params.get('status') || ''}
            onChange={(v) => update({ status: v })}
            options={[
              { value: '', label: 'All statuses' },
              ...choices(['Active', 'Inactive', 'Discontinued']),
            ]}
          />
          <Choice
            label="Stock level"
            value={params.get('stock') || ''}
            onChange={(v) => update({ stock: v })}
            options={[
              { value: '', label: 'All stock levels' },
              { value: 'low', label: `Low stock (≤ ${threshold})` },
              { value: 'out', label: 'Out of stock' },
              { value: 'healthy', label: 'Healthy stock' },
            ]}
          />
          <Choice
            label="Sort parts"
            value={
              (params.get('sort') || 'name') +
              ':' +
              (params.get('order') || 'asc')
            }
            onChange={(v) => {
              const [sort, order] = v.split(':');
              update({ sort, order });
            }}
            options={[
              { value: 'name:asc', label: 'Name A–Z' },
              { value: 'id:desc', label: 'Newest first' },
              { value: 'stock:asc', label: 'Stock: low to high' },
              { value: 'stock:desc', label: 'Stock: high to low' },
              { value: 'value:desc', label: 'Stock value: high to low' },
              { value: 'price:asc', label: 'Price: low to high' },
            ]}
          />
          {params.size > 0 && (
            <Button variant="ghost" onClick={() => go(ROOT + '/parts')}>
              Clear filters
            </Button>
          )}
        </div>
        <LoadState {...result} />
        {result.data &&
          (result.data.rows.length ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PART</TableHead>
                    <TableHead>UNIT PRICE</TableHead>
                    <TableHead>STATUS</TableHead>
                    <TableHead>CURRENT STOCK</TableHead>
                    <TableHead>STOCK VALUE</TableHead>
                    <TableHead className="text-right">ACTIONS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.data.rows.map((p) => (
                    <TableRow key={p.part_id}>
                      <TableCell>
                        <Button variant="ghost"
                          className="part-name"
                          onClick={() => go(partPath(p.part_id, url))}
                        >
                          {p.part_name}
                        </Button>
                        <small className="record-id">
                          {code('PT', p.part_id)}
                        </small>
                      </TableCell>
                      <TableCell>{money(p.unit_price)}</TableCell>
                      <TableCell>
                        <Status value={p.status} />
                      </TableCell>
                      <TableCell>
                        <div className="stock-cell">
                          <b>{p.current_stock}</b>
                          <span
                            className={
                              p.current_stock <= threshold
                                ? 'stock-warning'
                                : 'muted'
                            }
                          >
                            {p.current_stock === 0
                              ? 'Out of stock'
                              : p.current_stock <= threshold
                                ? 'Low stock'
                                : 'Healthy'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{money(p.stock_value)}</TableCell>
                      <TableCell>
                        <div className="row-actions">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={'Edit ' + p.part_name}
                            title="Edit part"
                            onClick={() =>
                              go(
                                partPath(p.part_id) +
                                  '/edit?back=' +
                                  encodeURIComponent(url),
                              )
                            }
                          >
                            <Edit3 />
                          </Button>
                          <Button
                            variant="outline"
                            disabled={p.status !== 'Active'}
                            title={
                              p.status !== 'Active'
                                ? 'Activate this part to change stock'
                                : 'Receive stock'
                            }
                            onClick={() => go(txPath(p.part_id, 'Stock In'))}
                          >
                            <ArrowDownLeft />
                            In
                          </Button>
                          <Button
                            variant="outline"
                            disabled={
                              p.status !== 'Active' || p.current_stock === 0
                            }
                            title={
                              p.status !== 'Active'
                                ? 'Activate this part to change stock'
                                : p.current_stock === 0
                                  ? 'No stock available'
                                  : 'Issue stock'
                            }
                            onClick={() => go(txPath(p.part_id, 'Stock Out'))}
                          >
                            <ArrowUpRight />
                            Out
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pager
                {...result.data}
                onPage={(page) => update({ page }, false)}
                onSize={(pageSize) => update({ pageSize })}
              />
            </>
          ) : (
            <NoResults
              action={
                <Button variant="outline" onClick={() => go(ROOT + '/parts')}>
                  Clear filters
                </Button>
              }
            />
          ))}
      </section>
    </>
  );
}
export function PartDetails({
  id,
  params,
}: {
  id: number;
  params: URLSearchParams;
}) {
  const { go, version, threshold } = useInventory();
  const result = useResource<Part>('/parts/' + id, version);
  const history = useResource<List<Transaction>>(
    '/transactions?part=' + id + '&pageSize=10',
    version,
  );
  const [selected, setSelected] = useState<Transaction | null>(null);
  const p = result.data;
  return (
    <>
      <PageTitle
        title={p?.part_name || 'Part Details'}
        crumb="Part Details"
        subtitle={p ? code('PT', p.part_id) : undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => go(safeBack(params))}>
              <ArrowLeft />
              Back to Parts
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                go(
                  ROOT +
                    '/parts/' +
                    id +
                    '/edit?back=' +
                    encodeURIComponent(safeBack(params)),
                )
              }
            >
              <Edit3 />
              Edit Part
            </Button>
            <Button
              disabled={!p || p.status !== 'Active'}
              onClick={() => go(txPath(id))}
            >
              <Plus />
              Record Transaction
            </Button>
          </>
        }
      />
      <LoadState {...result} />
      {p && (
        <>
          <div className="detail-grid">
            <section className="panel part-profile">
              <div className="part-symbol">
                <Package size={50} />
              </div>
              <div>
                <p className="eyebrow">PART INFORMATION</p>
                <h2>{p.part_name}</h2>
                <Status value={p.status} />
                <dl className="data-list">
                  <div>
                    <dt>Part ID</dt>
                    <dd>{code('PT', p.part_id)}</dd>
                  </div>
                  <div>
                    <dt>Unit price</dt>
                    <dd>{money(p.unit_price)}</dd>
                  </div>
                  <div>
                    <dt>Stock value</dt>
                    <dd>{money(p.stock_value)}</dd>
                  </div>
                </dl>
              </div>
            </section>
            <section className="panel stock-detail">
              <p className="eyebrow">CURRENT STOCK</p>
              <strong>
                {p.current_stock}
                <span> units</span>
              </strong>
              <p
                className={
                  p.current_stock <= threshold ? 'stock-warning' : 'positive'
                }
              >
                {p.current_stock === 0
                  ? 'Out of stock'
                  : p.current_stock <= threshold
                    ? 'Low stock — consider replenishing'
                    : 'Stock healthy'}
              </p>
              <p className="form-hint">
                Low-stock threshold: {threshold} units. Stock changes are
                recorded in the transaction history.
              </p>
              <div className="actions">
                <Button
                  disabled={p.status !== 'Active'}
                  onClick={() => go(txPath(id, 'Stock In'))}
                >
                  Stock In
                </Button>
                <Button
                  variant="outline"
                  disabled={p.status !== 'Active' || p.current_stock === 0}
                  onClick={() => go(txPath(id, 'Stock Out'))}
                >
                  Stock Out
                </Button>
              </div>
            </section>
          </div>
          <section className="panel mt-6">
            <div className="panel-heading">
              <h2>Transaction history</h2>
              <Button
                variant="ghost"
                onClick={() => go(ROOT + '/transactions?part=' + id)}
              >
                View all & filter
                <ArrowRight />
              </Button>
            </div>
            <LoadState {...history} />
            {history.data && (
              <TransactionTable
                rows={history.data.rows}
                onSelect={setSelected}
              />
            )}
          </section>
        </>
      )}
      <TransactionDrawer
        transaction={selected}
        close={() => setSelected(null)}
      />
    </>
  );
}
export function PartForm({
  id,
  params,
}: {
  id?: number;
  params: URLSearchParams;
}) {
  const { version } = useInventory();
  const result = useResource<Part>(id ? '/parts/' + id : null, version);
  if (id && (result.loading || result.error)) return <LoadState {...result} />;
  return (
    <PartEditor
      key={id || 'new'}
      part={result.data || undefined}
      params={params}
    />
  );
}
function PartEditor({
  part,
  params,
}: {
  part?: Part;
  params: URLSearchParams;
}) {
  const { go, setDirty, notify, refresh } = useInventory();
  const original = {
    part_name: part?.part_name || '',
    unit_price: part ? Number(part.unit_price).toFixed(2) : '',
    status: part?.status || 'Active',
  };
  const [form, setForm] = useState(original),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const changed = JSON.stringify(form) !== JSON.stringify(original);
  const validName =
    form.part_name.trim().length >= 2 && form.part_name.trim().length <= 120;
  const validPrice = /^\d{1,8}(\.\d{1,2})?$/.test(form.unit_price.trim());
  useEffect(() => {
    setDirty(changed);
    return () => setDirty(false);
  }, [changed, setDirty]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !validName || !validPrice) return;
    setBusy(true);
    setError('');
    try {
      const saved = await api<{ part_id: number }>(
        '/parts' + (part ? '/' + part.part_id : ''),
        part ? 'PUT' : 'POST',
        part ? { ...form, original } : form,
      );
      setDirty(false);
      notify(
        part
          ? 'Part updated in MySQL.'
          : 'Part added. Record Stock In to add inventory.',
      );
      refresh();
      go(partPath(saved.part_id, safeBack(params)), true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title={part ? 'Edit Part' : 'Add Part'}
        crumb={part ? 'Edit Part' : 'Add Part'}
        subtitle={
          part ? code('PT', part.part_id) : 'New parts start with zero stock.'
        }
      />
      <form onSubmit={submit} className="form-layout">
        <section className="panel">
          <h2 className="section-title">Part information</h2>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <label>
            Part name <span className="required">*</span>
            <Input
              value={form.part_name}
              onChange={(e) => setForm({ ...form, part_name: e.target.value })}
              required
              minLength={2}
              maxLength={120}
              disabled={busy}
              autoFocus
              aria-invalid={!!form.part_name && !validName}
            />
            {!!form.part_name && !validName && (
              <small className="field-error">Use 2–120 characters.</small>
            )}
          </label>
          <div className="form-columns">
            <label>
              Unit price ($) <span className="required">*</span>
              <Input
                value={form.unit_price}
                onChange={(e) =>
                  setForm({ ...form, unit_price: e.target.value })
                }
                required
                inputMode="decimal"
                placeholder="0.00"
                disabled={busy}
                aria-invalid={!!form.unit_price && !validPrice}
              />
              {!!form.unit_price && !validPrice && (
                <small className="field-error">
                  Enter a non-negative price with at most 2 decimals.
                </small>
              )}
            </label>
            <label htmlFor="part-status">
              Status <span className="required">*</span>
              <Choice
                id="part-status"
                label="Part status"
                value={form.status}
                onChange={(status) =>
                  setForm({ ...form, status: status as Part['status'] })
                }
                options={choices(['Active', 'Inactive', 'Discontinued'])}
                disabled={busy}
              />
            </label>
          </div>
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                go(
                  part
                    ? partPath(part.part_id, safeBack(params))
                    : safeBack(params),
                )
              }
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !changed || !validName || !validPrice}
            >
              {busy ? 'Saving…' : 'Save Part'}
            </Button>
          </div>
        </section>
        <aside className="panel form-aside">
          <Package />
          <h2>Stock is tracked separately</h2>
          <div className="readonly-stock">
            <span>Current stock</span>
            <b>{part?.current_stock || 0} units</b>
          </div>
          <p>
            Use Record Transaction to receive, issue, return or adjust stock.
            Editing a part never changes its quantity.
          </p>
          <p className="form-hint">
            Inactive and discontinued parts remain in the history. Activate them
            before recording new movements.
          </p>
        </aside>
      </form>
    </>
  );
}
export function TransactionsPage({ params }: { params: URLSearchParams }) {
  const { go, version } = useInventory();
  const result = useResource<List<Transaction>>(
    '/transactions?' + params,
    version,
  );
  const options = useResource<Options>('/options', version);
  const update = useFilters(params, ROOT + '/transactions');
  const [search, setSearch] = useState(params.get('q') || ''),
    [selected, setSelected] = useState<Transaction | null>(null);
  useEffect(() => setSearch(params.get('q') || ''), [params.toString()]);
  return (
    <>
      <PageTitle
        title="Inventory Transactions"
        subtitle="A read-only record of every stock movement."
        actions={
          <>
            <ExportButton
              endpoint={'/transactions/export?' + params}
              filename="coolcare-transactions.csv"
            />
            <Button onClick={() => go(txPath())}>
              <Plus />
              Record Transaction
            </Button>
          </>
        }
      />
      <section className="panel table-panel">
        <div className="filters">
          <form
            className="search-control"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: search });
            }}
          >
            <Search />
            <Input
              aria-label="Search transactions"
              placeholder="Search part, remarks or transaction ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={120}
            />
            <Button variant="secondary" type="submit">
              Search
            </Button>
          </form>
          <Choice
            label="Transaction type"
            value={params.get('type') || ''}
            onChange={(v) => update({ type: v })}
            options={[
              { value: '', label: 'All types' },
              ...choices(['Stock In', 'Stock Out', 'Return', 'Adjustment']),
            ]}
          />
          <Choice
            label="Filter by part"
            value={params.get('part') || ''}
            onChange={(v) => update({ part: v })}
            options={[
              { value: '', label: 'All parts' },
              ...(options.data?.parts || []).map((p) => ({
                value: String(p.part_id),
                label: p.part_name,
              })),
            ]}
          />
          <label className="date-filter">
            From
            <Input
              type="date"
              value={params.get('from') || ''}
              onChange={(e) => update({ from: e.target.value })}
            />
          </label>
          <label className="date-filter">
            To
            <Input
              type="date"
              value={params.get('to') || ''}
              onChange={(e) => update({ to: e.target.value })}
            />
          </label>
          {params.size > 0 && (
            <Button variant="ghost" onClick={() => go(ROOT + '/transactions')}>
              Clear filters
            </Button>
          )}
        </div>
        <LoadState {...result} />
        {result.data && (
          <>
            <TransactionTable rows={result.data.rows} onSelect={setSelected} />
            <Pager
              {...result.data}
              onPage={(page) => update({ page }, false)}
              onSize={(pageSize) => update({ pageSize })}
            />
          </>
        )}
      </section>
      <p className="form-hint">
        Newest first. Dates use the MySQL server’s local time. Saved
        transactions cannot be edited or deleted.
      </p>
      <TransactionDrawer
        transaction={selected}
        close={() => setSelected(null)}
      />
    </>
  );
}
function TransactionTable({
  rows,
  onSelect,
}: {
  rows: Transaction[];
  onSelect: (t: Transaction) => void;
}) {
  const { go } = useInventory();
  if (!rows.length)
    return (
      <NoResults
        title="No transactions found"
        description="Record a stock movement or change your filters."
      />
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>TRANSACTION / DATE</TableHead>
          <TableHead>PART</TableHead>
          <TableHead>TYPE</TableHead>
          <TableHead>CHANGE</TableHead>
          <TableHead>WORK ORDER</TableHead>
          <TableHead>ADMIN</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((t) => (
          <TableRow key={t.transaction_id}>
            <TableCell>
              <Button variant="ghost" className="part-name" onClick={() => onSelect(t)}>
                {code('TX', t.transaction_id)}
              </Button>
              <small className="record-id">{t.created_at}</small>
            </TableCell>
            <TableCell>
              <Button variant="ghost"
                className="part-name"
                onClick={() => go(partPath(t.part_id))}
              >
                {t.part_name}
              </Button>
              <small className="record-id">{code('PT', t.part_id)}</small>
            </TableCell>
            <TableCell>
              <Status value={t.transaction_type} />
            </TableCell>
            <TableCell
              className={
                t.stock_delta !== null && t.stock_delta > 0
                  ? 'positive numeric'
                  : 'numeric'
              }
            >
              {stockSign(t.stock_delta)}
            </TableCell>
            <TableCell>{t.job_id ? code('WO', t.job_id) : '—'}</TableCell>
            <TableCell>{t.admin_name || 'Not recorded'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
function TransactionDrawer({
  transaction: t,
  close,
}: {
  transaction: Transaction | null;
  close: () => void;
}) {
  const { go } = useInventory();
  return (
    <Sheet
      open={!!t}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent className="transaction-drawer">
        <SheetTitle>Transaction Details</SheetTitle>
        <SheetDescription>Saved audit record · read only</SheetDescription>
        {t && (
          <>
            <div className="drawer-id">
              {code('TX', t.transaction_id)}
              <Status value={t.transaction_type} />
            </div>
            <Button variant="ghost"
              className="part-name text-left"
              onClick={() => {
                close();
                go(partPath(t.part_id));
              }}
            >
              {t.part_name} <ArrowRight size={16} />
            </Button>
            <dl className="data-list">
              <div>
                <dt>Date / time</dt>
                <dd>{t.created_at}</dd>
              </div>
              <div>
                <dt>Quantity</dt>
                <dd>{t.quantity}</dd>
              </div>
              <div>
                <dt>Stock change</dt>
                <dd>{stockSign(t.stock_delta)}</dd>
              </div>
              <div>
                <dt>Stock before</dt>
                <dd>{t.stock_before ?? 'Not recorded'}</dd>
              </div>
              <div>
                <dt>Stock after</dt>
                <dd>{t.stock_after ?? 'Not recorded'}</dd>
              </div>
              <div>
                <dt>Work order</dt>
                <dd>
                  {t.job_id ? code('WO', t.job_id) : 'Not linked to a job'}
                </dd>
              </div>
              <div>
                <dt>Admin</dt>
                <dd>{t.admin_name || 'Not recorded'}</dd>
              </div>
            </dl>
            <h2>Remarks</h2>
            <p className="remarks">{t.remarks || 'No remarks.'}</p>
            {t.stock_before === null && (
              <p className="notice">
                Before/after quantities were not stored for this imported
                transaction.
              </p>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
export function TransactionForm({ params }: { params: URLSearchParams }) {
  const { version } = useInventory();
  const result = useResource<Options>('/options', version);
  return (
    <>
      <PageTitle
        title="Record Transaction"
        subtitle="Review the stock change before saving it to MySQL."
      />
      <LoadState {...result} />
      {result.data && (
        <TransactionEditor options={result.data} params={params} />
      )}
    </>
  );
}
function TransactionEditor({
  options,
  params,
}: {
  options: Options;
  params: URLSearchParams;
}) {
  const { go, setDirty, user, notify, refresh } = useInventory();
  const types = ['Stock In', 'Stock Out', 'Return', 'Adjustment'];
  const [partId, setPartId] = useState(params.get('part') || ''),
    [type, setType] = useState(
      types.includes(params.get('type') || '')
        ? params.get('type')!
        : 'Stock In',
    ),
    [quantity, setQuantity] = useState(''),
    [job, setJob] = useState(''),
    [remarks, setRemarks] = useState(''),
    [direction, setDirection] = useState('Increase'),
    [error, setError] = useState(''),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const requestId = useRef<string>('');
  const inFlight = useRef(false);
  const payload = useRef<Record<string, unknown> | null>(null);
  const [freshPart, setFreshPart] = useState<Part | null>(null);
  const [stockBusy, setStockBusy] = useState(false);
  const part =
    freshPart && String(freshPart.part_id) === partId
      ? freshPart
      : options.parts.find((p) => String(p.part_id) === partId);
  async function reloadStock() {
    if (!partId) return;
    setStockBusy(true);
    setError('');
    try {
      setFreshPart(await api<Part>('/parts/' + partId));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStockBusy(false);
    }
  }
  const qty = Number(quantity);
  const qtyValid = /^[1-9]\d*$/.test(quantity) && qty <= 2147483647;
  const delta =
    (type === 'Stock Out' || (type === 'Adjustment' && direction === 'Decrease')
      ? -1
      : 1) * qty;
  const after = (part?.current_stock || 0) + delta;
  const valid =
    !!part &&
    part.status === 'Active' &&
    qtyValid &&
    after >= 0 &&
    after <= 2147483647 &&
    (type !== 'Adjustment' || !!remarks.trim()) &&
    remarks.length <= 500;
  const changed =
    !!quantity ||
    !!remarks ||
    !!job ||
    partId !== (params.get('part') || '') ||
    type !==
      (types.includes(params.get('type') || '')
        ? params.get('type')!
        : 'Stock In');
  useEffect(() => {
    setDirty(changed || uncertain);
    return () => setDirty(false);
  }, [changed, uncertain, setDirty]);
  function openReview(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !part) return;
    setError('');
    requestId.current = crypto.randomUUID();
    payload.current = {
      request_id: requestId.current,
      part_id: part.part_id,
      transaction_type: type,
      quantity: qty,
      expected_stock: part.current_stock,
      job_id: job ? Number(job) : null,
      remarks: remarks.trim(),
      ...(type === 'Adjustment' ? { direction } : {}),
    };
    setReview(true);
  }
  async function confirm() {
    if (inFlight.current || !payload.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await api<{ part_id: number; stock_after: number }>(
        '/transactions',
        'POST',
        payload.current,
      );
      setUncertain(false);
      setDirty(false);
      setReview(false);
      notify(`Transaction saved. Current stock: ${saved.stock_after} units.`);
      refresh();
      go(partPath(saved.part_id), true);
    } catch (e) {
      setError(errorText(e));
      setUncertain(!(e instanceof ApiError) || e.status >= 500);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <form className="form-layout" onSubmit={openReview}>
        <section className="panel">
          <h2 className="section-title">Stock movement</h2>
          {error && !review && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <label htmlFor="transaction-part">
            Part <span className="required">*</span>
            <Choice
              id="transaction-part"
              label="Part"
              value={partId}
              onChange={setPartId}
              options={[
                { value: '', label: 'Select a part' },
                ...options.parts.map((p) => ({
                  value: String(p.part_id),
                  label: `${p.part_name} · ${code('PT', p.part_id)}${p.status !== 'Active' ? ' · ' + p.status : ''}`,
                })),
              ]}
            />
          </label>
          {!options.parts.length && (
            <p className="notice">
              No parts exist yet.{' '}
              <Button variant="ghost"
                type="button"
                className="text-link"
                onClick={() => go(ROOT + '/parts/new')}
              >
                Add a part first
              </Button>
              .
            </p>
          )}
          <div className="form-columns">
            <label htmlFor="transaction-type">
              Transaction type <span className="required">*</span>
              <Choice
                id="transaction-type"
                label="Transaction type"
                value={type}
                onChange={setType}
                options={choices(types)}
              />
            </label>
            <label>
              Quantity <span className="required">*</span>
              <Input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                inputMode="numeric"
                placeholder="Enter whole units"
                required
                pattern="[1-9][0-9]*"
                aria-invalid={!!quantity && !qtyValid}
              />
              {!!quantity && !qtyValid && (
                <small className="field-error">
                  Enter a positive whole number.
                </small>
              )}
            </label>
          </div>
          {type === 'Return' && (
            <p className="notice">
              Return means unused parts returned into inventory; stock
              increases.
            </p>
          )}
          {type === 'Adjustment' && (
            <label htmlFor="adjustment-direction">
              Adjustment direction <span className="required">*</span>
              <Choice
                id="adjustment-direction"
                label="Adjustment direction"
                value={direction}
                onChange={setDirection}
                options={choices(['Increase', 'Decrease'])}
              />
            </label>
          )}
          <label htmlFor="job-id">
            Work order <span className="optional">optional</span>
            <Choice
              id="job-id"
              label="Work order"
              value={job}
              onChange={setJob}
              options={[
                { value: '', label: 'Not linked to a job' },
                ...options.jobs.map((j) => ({
                  value: String(j.job_id),
                  label: `${code('WO', j.job_id)} · ${j.current_status}`,
                })),
              ]}
            />
          </label>
          <label>
            {type === 'Adjustment' ? 'Reason *' : 'Remarks (optional)'}
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              maxLength={500}
              rows={4}
              required={type === 'Adjustment'}
              placeholder={
                type === 'Adjustment'
                  ? 'Explain why this stock correction is needed.'
                  : 'Add a reference or note for this movement.'
              }
            />
            <small className="character-count">{remarks.length} / 500</small>
          </label>
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                go(part ? partPath(part.part_id) : ROOT + '/transactions')
              }
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              <Check />
              Review Transaction
            </Button>
          </div>
        </section>
        <aside className="panel form-aside preview-card">
          <p className="eyebrow">TRANSACTION PREVIEW</p>
          <h2>{part?.part_name || 'Select a part'}</h2>
          <dl className="data-list">
            <div>
              <dt>Type</dt>
              <dd>{type}</dd>
            </div>
            <div>
              <dt>Current stock</dt>
              <dd>{part?.current_stock ?? '—'}</dd>
            </div>
            <div>
              <dt>Stock change</dt>
              <dd>{qtyValid ? stockSign(delta) : '—'}</dd>
            </div>
          </dl>
          <div className="projected">
            <span>Projected stock</span>
            <strong className={after < 0 ? 'stock-warning' : ''}>
              {part && qtyValid ? after : '—'}
              <small> units</small>
            </strong>
          </div>
          {part && part.status !== 'Active' && (
            <p className="notice error">
              This part is {part.status.toLowerCase()}. Activate it before
              changing stock.
            </p>
          )}
          {part && qtyValid && after < 0 && (
            <p className="notice error" role="alert">
              Not enough stock. Only {part.current_stock} units are available.
            </p>
          )}
          <p className="form-hint">
            Recorded by {user.full_name}. Saving adds an immutable transaction
            and updates stock together.
          </p>
          <Button
            type="button"
            variant="ghost"
            disabled={!partId || stockBusy}
            onClick={reloadStock}
          >
            <RefreshCw />
            Reload stock
          </Button>
        </aside>
      </form>
      <Dialog
        open={review}
        onOpenChange={(open) => {
          if (!busy && !uncertain) setReview(open);
        }}
      >
        <DialogContent
          className="review-dialog"
          showCloseButton={!busy && !uncertain}
        >
          <DialogTitle>Confirm stock movement</DialogTitle>
          <DialogDescription>
            This will update MySQL and create a permanent transaction record.
          </DialogDescription>
          <h2>{part?.part_name}</h2>
          <dl className="data-list">
            <div>
              <dt>Type</dt>
              <dd>
                {type}
                {type === 'Adjustment' ? ' · ' + direction : ''}
              </dd>
            </div>
            <div>
              <dt>Quantity</dt>
              <dd>{qty}</dd>
            </div>
            <div>
              <dt>Stock</dt>
              <dd>
                {part?.current_stock} → {after}
              </dd>
            </div>
            <div>
              <dt>Work order</dt>
              <dd>{job ? code('WO', Number(job)) : 'Not linked'}</dd>
            </div>
            <div>
              <dt>Admin</dt>
              <dd>{user.full_name}</dd>
            </div>
          </dl>
          {remarks && <p className="remarks">{remarks}</p>}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {uncertain && (
            <p className="notice">
              The outcome could not be confirmed. Retry this same submission to
              check it safely; its request ID prevents a duplicate stock change.
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy || uncertain}
              onClick={() => setReview(false)}
            >
              Back to form
            </Button>
            <Button onClick={confirm} disabled={busy}>
              {busy
                ? 'Saving…'
                : uncertain
                  ? 'Retry same submission'
                  : 'Confirm & Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
