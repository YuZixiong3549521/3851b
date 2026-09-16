import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { X, MapPin, CalendarDays, Clock3, Wrench, Package } from 'lucide-react';
import { StatusBadge, PriorityBadge } from './Badges.jsx';
import { formatDate, formatTime } from '../utils/jobs.js';
import { mockMode, technicianRequest } from '../services/jobService.js';
const formatMoment = (value) =>
  value ? String(value).replace('T', ' ').slice(0, 19) : 'Not recorded';

function InventoryUsed({ items = [] }) {
  return items.length ? (
    <ul className="tech-detail-list">
      {items.map((item) => (
        <li key={item.transactionId}>
          <strong>{item.partName}</strong>: {item.quantity} {item.stockUnit} ·{' '}
          {item.type}
          {item.remarks && <small>{item.remarks}</small>}
        </li>
      ))}
    </ul>
  ) : (
    <p>No inventory usage recorded.</p>
  );
}
function Report({ report }) {
  return (
    <div className="tech-report">
      <p>
        <strong>Work performed:</strong> {report.workPerformed}
      </p>
      <p>
        <strong>Problem found:</strong> {report.problemFound || 'Not recorded'}
      </p>
      <p>
        <strong>Solution:</strong> {report.solutionApplied || 'Not recorded'}
      </p>
      <p>
        <strong>Checklist:</strong> {report.checklist || 'Not recorded'}
      </p>
      <p>
        <strong>Cleaning method:</strong>{' '}
        {report.cleaningMethod || 'Not recorded'}
      </p>
      {report.cleaningAssessmentNote && (
        <p>
          <strong>Technician assessment:</strong>{' '}
          {report.cleaningAssessmentNote}
        </p>
      )}
      <p>
        <strong>Actual duration:</strong>{' '}
        {report.durationMinutes === null
          ? 'Not recorded'
          : `${report.durationMinutes} minutes`}
      </p>
      <p>
        <strong>Start / finish:</strong> {report.startedAt || 'Not recorded'} /{' '}
        {report.completedAt || 'Not recorded'}
      </p>
      <h4>Parts used</h4>
      <InventoryUsed items={report.inventory} />
    </div>
  );
}
function History({ items, empty }) {
  return items.length ? (
    items.map((report) => (
      <details key={report.reportId} className="tech-history">
        <summary>
          {formatDate(report.date)} · WO-{String(report.jobId).padStart(4, '0')}
          {report.packageName && ` · ${report.packageName}`}
        </summary>
        <p className="cell-icon">
          <MapPin size={15} />
          {report.address}
        </p>
        <Report report={report} />
      </details>
    ))
  ) : (
    <p>{empty}</p>
  );
}
const canonicalStatus = (value) =>
  value === 'On the Way' ? 'On The Way' : value;
const nextStatus = {
  Assigned: 'On The Way',
  'On The Way': 'In Progress',
  'In Progress': 'Completed',
};
function WorkStatusActions({
  job,
  onSaved,
  onReload,
  onStatusChanged,
  lock,
  externallyLocked,
}) {
  const current = canonicalStatus(job.status),
    next = nextStatus[current];
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false);
  const pending = useRef(null),
    inFlight = useRef(false);
  if (!next || mockMode) return null;
  async function advance() {
    if (inFlight.current || (externallyLocked && !busy && !uncertain)) return;
    pending.current ??= {
      requestId: crypto.randomUUID(),
      expectedStatus: current,
      status: next,
    };
    inFlight.current = true;
    setBusy(true);
    lock(true);
    setError('');
    try {
      await technicianRequest(`/jobs/${job.jobId}/status`, {
        method: 'PATCH',
        body: pending.current,
      });
      pending.current = null;
      setUncertain(false);
      lock(false);
      onSaved(`Work order moved to ${next}.`);
      onStatusChanged();
      onReload();
    } catch (e) {
      setError(e.message);
      const unknown = !e.status || e.status >= 500;
      setUncertain(unknown);
      lock(unknown);
      if (!unknown) pending.current = null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const label =
    next === 'On The Way'
      ? 'Start journey'
      : next === 'In Progress'
        ? 'Start service'
        : 'Complete service';
  return (
    <section className="tech-status-actions">
      <h3>Work order status</h3>
      <p>
        Update this work order one step at a time. The customer will see the
        same status.
      </p>
      {error && (
        <p className="tech-error" role="alert">
          {error}
        </p>
      )}
      {uncertain && (
        <output>
          The result could not be confirmed. Retry the same update to check it
          safely.
        </output>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || (externallyLocked && !uncertain)}
          onClick={advance}
        >
          {busy ? 'Updating…' : uncertain ? 'Retry same update' : label}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || uncertain}
          onClick={onReload}
        >
          Reload status
        </Button>
      </div>
    </section>
  );
}
function CleaningAssessment({
  job,
  history,
  onSaved,
  onReload,
  lock,
  externallyLocked,
}) {
  const current = job.cleaningAssessment;
  const [method, setMethod] = useState(current?.method || ''),
    [note, setNote] = useState(current?.note || ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false);
  const pending = useRef(null),
    inFlight = useRef(false);
  const editable =
    job.cleaningEligible && !['Completed', 'Cancelled'].includes(job.status);
  async function save(e) {
    e.preventDefault();
    if (
      inFlight.current ||
      (externallyLocked && !busy && !uncertain) ||
      (!uncertain && (!method || note.trim().length < 5))
    )
      return;
    pending.current ??= {
      requestId: crypto.randomUUID(),
      expectedVersion: current?.version ?? 0,
      method,
      note: note.trim(),
    };
    inFlight.current = true;
    setBusy(true);
    lock(true);
    setError('');
    try {
      await technicianRequest(`/jobs/${job.jobId}/cleaning-assessment`, {
        method: 'PATCH',
        body: pending.current,
      });
      pending.current = null;
      setUncertain(false);
      lock(false);
      onSaved('Cleaning assessment saved. The booking price has not changed.');
    } catch (e) {
      setError(e.message);
      const unknown = !e.status || e.status >= 500;
      setUncertain(unknown);
      lock(unknown);
      if (!unknown) pending.current = null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (!job.cleaningEligible && !current && !history.length) return null;
  return (
    <section className="tech-cleaning-assessment">
      <h3>Technician cleaning assessment</h3>
      <p>
        Regular or Chemical cleaning is selected after inspecting the equipment.
      </p>
      <p className="tech-guidance">
        Saving a method records your assessment and does not authorise an extra
        charge. Explain and agree any extra work and its quote with the customer
        before proceeding.
      </p>
      {current && (
        <p>
          Last decision: <strong>{current.method}</strong> ·{' '}
          {current.assessedBy} · {formatMoment(current.updatedAt)}
        </p>
      )}
      {editable ? (
        <form onSubmit={save} className="tech-stock-form">
          <fieldset disabled={externallyLocked && !busy && !uncertain}>
            <label htmlFor="cleaning-method">
              Cleaning method
              <NativeSelect
                id="cleaning-method"
                aria-label="Cleaning method"
                required
                value={method}
                disabled={busy || uncertain}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="">Select after inspection</option>
                <option value="Regular">Regular cleaning</option>
                <option value="Chemical">Chemical cleaning</option>
              </NativeSelect>
            </label>
            <label htmlFor="cleaning-assessment-note">
              Assessment and proposed work
              <Textarea
                id="cleaning-assessment-note"
                aria-label="Assessment and proposed work"
                required
                minLength={5}
                maxLength={1500}
                value={note}
                disabled={busy || uncertain}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Record equipment condition, your recommendation and any work to discuss with the customer."
              />
            </label>
            {error && (
              <p className="tech-error" role="alert">
                {error}
              </p>
            )}
            {uncertain && (
              <output>
                The result could not be confirmed. Retry the same assessment to
                check it safely.
              </output>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={
                  busy || (!uncertain && (!method || note.trim().length < 5))
                }
              >
                {busy
                  ? 'Saving…'
                  : uncertain
                    ? 'Retry same assessment'
                    : 'Save assessment'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || uncertain}
                onClick={onReload}
              >
                Reload current decision
              </Button>
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          <p>
            {current?.note ||
              'No cleaning assessment was recorded for this historical work order.'}
          </p>
          <p>Historical and cancelled work orders are read-only.</p>
        </>
      )}
      {history.length > 0 && (
        <details className="tech-history">
          <summary>Assessment change history</summary>
          {history.map((item) => (
            <article key={item.version} className="tech-assessment-revision">
              <p>
                <strong>Version {item.version}</strong> · {item.changedBy} ·{' '}
                {formatMoment(item.changedAt)}
              </p>
              <p>
                Method: {item.beforeMethod || 'Not recorded'} →{' '}
                {item.afterMethod}
              </p>
              <p>Previous note: {item.beforeNote || 'Not recorded'}</p>
              <p>Saved note: {item.afterNote}</p>
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
function StockOut({
  jobId,
  options,
  onSaved,
  onReload,
  lock,
  externallyLocked,
}) {
  const [partId, setPartId] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [remarks, setRemarks] = useState(''),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false);
  const pending = useRef(null),
    inFlight = useRef(false);
  const part = options.parts.find((p) => String(p.part_id) === partId);
  const qty = Number(quantity),
    excess = part && Number(part.issued) + qty > part.recommended;
  const valid =
    part &&
    Number.isInteger(qty) &&
    qty > 0 &&
    qty <= part.current_stock &&
    (!excess || ack);
  async function issue(e) {
    e.preventDefault();
    if (
      inFlight.current ||
      (externallyLocked && !busy && !uncertain) ||
      (!uncertain && !valid)
    )
      return;
    pending.current ??= {
      request_id: crypto.randomUUID(),
      part_id: part.part_id,
      quantity: qty,
      expected_stock: part.current_stock,
      remarks,
      acknowledge_excess: ack,
    };
    inFlight.current = true;
    setBusy(true);
    lock(true);
    setError('');
    try {
      const result = await technicianRequest(`/jobs/${jobId}/stock-out`, {
        body: pending.current,
      });
      pending.current = null;
      setUncertain(false);
      lock(false);
      onSaved(
        `Stock issued. Transaction TX-${String(result.transaction_id).padStart(4, '0')}; remaining stock: ${result.stock_after}.`,
      );
    } catch (e) {
      setError(e.message);
      const unknown = !e.status || e.status >= 500;
      setUncertain(unknown);
      lock(unknown);
      if (!unknown) pending.current = null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={issue} className="tech-stock-form">
      <fieldset disabled={externallyLocked && !busy && !uncertain}>
        <h3 className="cell-icon">
          <Package size={18} />
          Issue parts to this work order
        </h3>
        <p>
          {options.acCount} AC unit(s). Recommendations apply to the total
          already issued plus this request.
        </p>
        <label htmlFor="stock-part">
          Part
          <NativeSelect
            id="stock-part"
            aria-label="Part"
            required
            value={partId}
            disabled={busy || uncertain}
            onChange={(e) => {
              setPartId(e.target.value);
              setAck(false);
            }}
          >
            <option value="">Select a part</option>
            {options.parts.map((p) => (
              <option key={p.part_id} value={p.part_id}>
                {p.part_name} · {p.current_stock} {p.stock_unit} available
              </option>
            ))}
          </NativeSelect>
        </label>
        {part && (
          <div className="tech-guidance">
            <p>
              Per AC: {part.recommended_units_per_ac} {part.stock_unit}.
              Recommended total: {part.recommended}. Already issued:{' '}
              {part.issued}.
            </p>
            <p>
              {part.usage_note || 'Review the actual parts required on site.'}
            </p>
          </div>
        )}
        <label htmlFor="stock-quantity">
          Quantity
          <Input
            id="stock-quantity"
            type="number"
            min="1"
            max={part?.current_stock || 2147483647}
            step="1"
            required
            value={quantity}
            disabled={busy || uncertain}
            onChange={(e) => {
              setQuantity(e.target.value);
              setAck(false);
            }}
          />
        </label>
        <label htmlFor="stock-description">
          Description
          <Textarea
            id="stock-description"
            maxLength={500}
            value={remarks}
            disabled={busy || uncertain}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Describe what these parts will be used for."
          />
        </label>
        {excess && (
          <label className="tech-excess">
            <input
              type="checkbox"
              checked={ack}
              disabled={busy || uncertain}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span>
              This exceeds the work order recommendation. I have reviewed the
              extra quantity and acknowledge the additional usage.
            </span>
          </label>
        )}
        {part && qty > part.current_stock && (
          <p className="tech-error" role="alert">
            Not enough stock. Only {part.current_stock} {part.stock_unit}{' '}
            available.
          </p>
        )}
        {error && (
          <p className="tech-error" role="alert">
            {error}
          </p>
        )}
        {uncertain && (
          <output>
            The result could not be confirmed. Retry this same request to avoid
            issuing stock twice.
          </output>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || (!uncertain && !valid)}>
            {busy
              ? 'Saving…'
              : uncertain
                ? 'Retry same request'
                : 'Confirm stock out'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || uncertain}
            onClick={onReload}
          >
            Reload stock
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
export default function JobDrawer({
  job: summary,
  onClose,
  onStatusChanged = () => {},
}) {
  const [detail, setDetail] = useState(null),
    [options, setOptions] = useState(null),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0),
    [locked, setLocked] = useState(false),
    [notice, setNotice] = useState('');
  useEffect(() => {
    if (mockMode) return;
    const controller = new AbortController();
    Promise.all([
      technicianRequest(`/jobs/${summary.jobId}`, {
        signal: controller.signal,
      }),
      technicianRequest(`/jobs/${summary.jobId}/parts`, {
        signal: controller.signal,
      }),
    ])
      .then(([details, parts]) => {
        if (!controller.signal.aborted) {
          setDetail(details);
          setOptions(parts);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [summary.jobId, version]);
  const job = detail?.job || summary;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl p-0"
        aria-describedby={undefined}
      >
        <div className="drawer-inner">
          <div className="drawer-heading">
            <span className="job-id">{job.id}</span>
            <Button
              variant="ghost"
              className="icon-button"
              disabled={locked}
              onClick={onClose}
              aria-label="Close job details"
            >
              <X />
            </Button>
          </div>
          <DialogTitle>{job.customer}</DialogTitle>
          <div className="drawer-badges">
            <StatusBadge value={job.status} />
            <PriorityBadge value={job.priority} />
          </div>
          <h3>Appointment</h3>
          <p className="cell-icon">
            <CalendarDays size={18} />
            {formatDate(job.date)}
          </p>
          <p className="cell-icon">
            <Clock3 size={18} />
            {formatTime(job.time)}
          </p>
          <p className="cell-icon">
            <Wrench size={18} />
            {job.serviceType}
          </p>
          <p>
            Estimated duration:{' '}
            {job.estimatedDurationMinutes
              ? `${job.estimatedDurationMinutes} minutes`
              : 'Not recorded'}
          </p>
          <p>Last modified: {job.lastModified || 'Not recorded'}</p>
          <WorkStatusActions
            job={job}
            lock={setLocked}
            externallyLocked={locked}
            onReload={() => setVersion((v) => v + 1)}
            onStatusChanged={onStatusChanged}
            onSaved={(text) => setNotice(text)}
          />
          <h3>Service address</h3>
          <p className="cell-icon">
            <MapPin size={18} />
            {job.address}
          </p>
          <p>{job.acCount ?? '—'} AC unit(s) linked to this booking.</p>
          <h3>Reported problem / service notes</h3>
          <p>{job.reportedProblem || 'No additional details provided.'}</p>
          {error && (
            <div role="alert" className="tech-error">
              <p>{error}</p>
              <Button
                variant="outline"
                onClick={() => setVersion((v) => v + 1)}
              >
                Reload job details
              </Button>
            </div>
          )}
          {!detail && !error && !mockMode && (
            <output>Loading service history and inventory…</output>
          )}
          {detail && (
            <>
              <CleaningAssessment
                key={`assessment-${job.jobId}-${version}`}
                job={job}
                history={detail.cleaningAssessmentHistory || []}
                lock={setLocked}
                externallyLocked={locked}
                onReload={() => setVersion((v) => v + 1)}
                onSaved={(text) => {
                  setNotice(text);
                  setVersion((v) => v + 1);
                }}
              />
              <h3>Work details</h3>
              {job.report ? (
                <Report report={job.report} />
              ) : (
                <>
                  <p>
                    No service report has been submitted. Actual duration and
                    work performed have not been recorded.
                  </p>
                  <InventoryUsed items={job.inventory} />
                </>
              )}
              <h3>Latest 3 completed visits at this address</h3>
              <History
                items={detail.addressHistory}
                empty="No earlier completed service reports at this address."
              />
              {job.annualSeriesId && (
                <section>
                  <h3>
                    Annual Cleaning Bundle · visit {job.annualVisitNumber} of 4
                  </h3>
                  <p>
                    This visit window starts {job.annualWindowStart} and ends
                    before {job.annualWindowEnd}.
                  </p>
                  <h4>Earlier completed visits in this bundle</h4>
                  <History
                    items={detail.annualHistory || []}
                    empty="No earlier completed reports for this annual bundle yet."
                  />
                </section>
              )}
              {(detail.packages.length > 0 ||
                detail.packageHistory.length > 0) && (
                <details className="tech-history">
                  <summary>Legacy package records</summary>
                  <p>
                    Previous package records are retained for service context.
                  </p>
                  <ul className="tech-detail-list">
                    {detail.packages.map((p) => (
                      <li key={p.subscriptionId}>
                        <strong>{p.packageName}</strong> · {p.status}
                        <small>
                          Recorded balance: {p.remainingVisits} visits ·{' '}
                          {p.startDate} to {p.endDate}
                        </small>
                      </li>
                    ))}
                  </ul>
                  <History
                    items={detail.packageHistory}
                    empty="No earlier completed reports attached to legacy packages."
                  />
                </details>
              )}
            </>
          )}
          {notice && <output className="tech-guidance">{notice}</output>}
          {options && (
            <StockOut
              key={`${job.jobId}-${version}`}
              jobId={job.jobId}
              options={options}
              lock={setLocked}
              externallyLocked={locked}
              onReload={() => setVersion((v) => v + 1)}
              onSaved={(text) => {
                setNotice(text);
                setVersion((v) => v + 1);
              }}
            />
          )}
          <Button
            variant="ghost"
            className="detail-button"
            disabled={locked}
            onClick={onClose}
          >
            Back to jobs
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
