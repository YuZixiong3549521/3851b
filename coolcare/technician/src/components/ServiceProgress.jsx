import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { technicianRequest } from '../services/jobService.js';
import { formatDate, formatTime } from '../utils/jobs.js';

export default function ServiceProgress({
  jobId,
  status,
  repairEligible,
  progress,
  onSaved,
  disabled = false,
  onLockedChange = () => {},
}) {
  const [action, setAction] = useState(''),
    [minutes, setMinutes] = useState('30'),
    [reason, setReason] = useState(''),
    [notes, setNotes] = useState(''),
    [partNotes, setPartNotes] = useState(''),
    [date, setDate] = useState(''),
    [start, setStart] = useState('09:00'),
    [duration, setDuration] = useState('60'),
    [amount, setAmount] = useState(String(progress?.additionalRepairFee ?? 0)),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(null),
    inFlight = useRef(false);
  if (!progress) return null;
  const follow = progress.followUpStatus;
  const actions = [
    ...(status === 'In Progress' || follow === 'In Progress'
      ? [['extend', 'Extend service time']]
      : []),
    ...(['None', 'Completed'].includes(follow)
      ? [['require-return', 'Return visit required']]
      : []),
    ...(['Required', 'Scheduled'].includes(follow) && status === 'Completed'
      ? [
          [
            'schedule-return',
            follow === 'Scheduled'
              ? 'Reschedule return visit'
              : 'Schedule return visit',
          ],
        ]
      : []),
    ...(follow === 'Scheduled' ? [['start-return', 'Start return visit']] : []),
    ...(follow === 'In Progress'
      ? [['complete-return', 'Complete return visit']]
      : []),
    ...(repairEligible ? [['repair-quote', 'Set additional repair fee']] : []),
  ];
  const reasons =
    action === 'extend'
      ? [
          'More cleaning required',
          'Complex repair',
          'Additional checks',
          'Other',
        ]
      : [
          'Part unavailable',
          'Additional diagnosis',
          'More time required',
          'Other',
        ];
  const locked = busy || uncertain || disabled;
  async function save(e) {
    e.preventDefault();
    if (inFlight.current || (!uncertain && disabled)) return;
    pending.current ??= {
      requestId: crypto.randomUUID(),
      expectedVersion: progress.version,
      action,
      notes: notes.trim(),
      ...(action === 'extend' ? { minutes: Number(minutes), reason } : {}),
      ...(action === 'require-return'
        ? { reason, partNotes: partNotes.trim() }
        : {}),
      ...(action === 'schedule-return'
        ? { date, start, durationMinutes: Number(duration) }
        : {}),
      ...(action === 'complete-return' ? { partNotes: partNotes.trim() } : {}),
      ...(action === 'repair-quote' ? { amount: Number(amount) } : {}),
    };
    inFlight.current = true;
    setBusy(true);
    setError('');
    onLockedChange(true);
    let saved=false;
    try {
      await technicianRequest(`/jobs/${jobId}/service-progress`, {
        method: 'PATCH',
        body: pending.current,
      });
      saved=true;
      pending.current = null;
      setUncertain(false);
      setAction('');
      setNotes('');
      setPartNotes('');
      onLockedChange(false);
      await onSaved();
    } catch (e) {
      if(saved){setError('The update was saved, but the latest details could not be loaded. Reload updates before making another change.');setUncertain(false);onLockedChange(false);return;}
      setError(e.message);
      const unknown = !e.status || e.status >= 500;
      setUncertain(unknown);
      onLockedChange(unknown);
      if (!unknown) pending.current = null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="tech-cleaning-assessment space-y-4">
      <h3>Service updates and outcome</h3>
      <p>
        All updates are retained with this work order and its original service
        report. Customers and administrators can view them.
      </p>
      <div className="tech-guidance space-y-1">
        <p>
          Return visit:{' '}
          <strong>{follow === 'None' ? 'Not required' : follow}</strong>
        </p>
        {progress.extensionMinutes > 0 && (
          <p>
            Extra time: {progress.extensionMinutes} minutes · Expected finish:{' '}
            {formatTime(progress.expectedEndTime)}
          </p>
        )}
        {progress.followUpDate && (
          <p>
            Return appointment: {formatDate(progress.followUpDate)} ·{' '}
            {formatTime(progress.followUpStart)} –{' '}
            {formatTime(progress.followUpEnd)}
          </p>
        )}
        {repairEligible && (
          <p>
            Additional repair fee:{' '}
            <strong>
              SGD {Number(progress.additionalRepairFee).toFixed(2)}
            </strong>
            {progress.repairQuoteNote && ` · ${progress.repairQuoteNote}`}
          </p>
        )}
      </div>
      {['In Progress', 'Completed'].includes(status) && (
        <form className="tech-stock-form" onSubmit={save}>
          <fieldset disabled={locked} className="space-y-4">
            <label>
              Service update
              <NativeSelect
                aria-label="Service update"
                required
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setReason('');
                  setError('');
                }}
              >
                <option value="">Choose an update</option>
                {actions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {action === 'extend' && (
              <label>
                Additional time
                <NativeSelect
                  aria-label="Additional time"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                >
                  {[15, 30, 45, 60, 90, 120].map((n) => (
                    <option key={n} value={n}>
                      {n} minutes
                    </option>
                  ))}
                </NativeSelect>
              </label>
            )}
            {['extend', 'require-return'].includes(action) && (
              <label>
                Reason
                <NativeSelect
                  aria-label="Update reason"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  <option value="">Choose a reason</option>
                  {reasons.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </NativeSelect>
              </label>
            )}
            {['require-return', 'complete-return'].includes(action) && (
              <label>
                Parts needed / used
                <Textarea
                  aria-label="Return visit parts"
                  required={
                    action === 'require-return' && reason === 'Part unavailable'
                  }
                  minLength={reason === 'Part unavailable' ? 5 : undefined}
                  maxLength={2000}
                  value={partNotes}
                  onChange={(e) => setPartNotes(e.target.value)}
                  placeholder="Record part name, quantity and availability, or parts used on the return visit."
                />
              </label>
            )}
            {action === 'schedule-return' && (
              <>
                <EnglishDatePicker
                  label="Return visit date"
                  value={date}
                  onChange={setDate}
                  disabled={locked}
                />
                <label>
                  Start time
                  <NativeSelect
                    aria-label="Return visit start time"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  >
                    {Array.from(
                      { length: 36 },
                      (_, i) =>
                        `${String(9 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
                    ).map((t) => (
                      <option key={t} value={t}>
                        {formatTime(t)}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label>
                  Planned duration
                  <NativeSelect
                    aria-label="Return visit duration"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  >
                    {[30, 45, 60, 90, 120, 180, 240].map((n) => (
                      <option key={n} value={n}>
                        {n} minutes
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <p>
                  Choose a future weekday after discussing the appointment with
                  the customer. Availability is checked when saved.
                </p>
              </>
            )}
            {action === 'repair-quote' && (
              <>
                <label>
                  Additional repair fee (SGD)
                  <Input
                    aria-label="Additional repair fee"
                    type="number"
                    required
                    min="0"
                    max="100000"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <p>
                  This replaces the current additional fee; it is added to the
                  booking's minimum fee. No separate approval is required. This
                  does not record a payment.
                </p>
              </>
            )}
            {action && (
              <label>
                {action === 'repair-quote'
                  ? 'Repair work and fee breakdown'
                  : 'Work details / update notes'}
                <Textarea
                  aria-label="Service update notes"
                  required
                  minLength={5}
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Describe the work, reason and next steps. These notes are visible to the customer and administrator."
                />
              </label>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="tech-error">
              {error}
            </p>
          )}
          {uncertain && (
            <p role="status">
              The result could not be confirmed. Retry the same update to avoid
              adding it twice.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={
                busy ||
                (disabled && !uncertain) ||
                (!uncertain &&
                  (!action || (action === 'schedule-return' && !date)))
              }
            >
              {busy
                ? 'Saving…'
                : uncertain
                  ? 'Retry same update'
                  : 'Save service update'}
            </Button>
            {!locked && (
              <Button type="button" variant="outline" onClick={async()=>{try{setError('');await onSaved();}catch(e){setError(e.message);}}}>
                Reload updates
              </Button>
            )}
          </div>
        </form>
      )}
      {progress.events.length > 0 && (
        <details className="tech-history" open>
          <summary>Service update history ({progress.events.length})</summary>
          <ul className="tech-detail-list">
            {progress.events.map((event) => (
              <li key={event.id} className="space-y-1">
                <strong>{event.kind}</strong>
                <small>
                  {event.createdAt} · {event.createdBy}
                </small>
                <p>
                  {event.reason}
                  {event.minutes ? ` · ${event.minutes} minutes` : ''}
                  {event.amount !== null
                    ? ` · SGD ${Number(event.amount).toFixed(2)}`
                    : ''}
                </p>
                <p className="whitespace-pre-wrap">{event.notes}</p>
                {event.partNotes && <p>Parts: {event.partNotes}</p>}
                {event.followUpDate && (
                  <p>
                    {formatDate(event.followUpDate)} ·{' '}
                    {formatTime(event.followUpStart)} –{' '}
                    {formatTime(event.followUpEnd)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
