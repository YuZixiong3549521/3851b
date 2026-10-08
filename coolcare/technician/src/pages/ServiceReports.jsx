import ReportChecks from '../components/ReportChecks.jsx';
import { parseChecks, summarizeChecks } from '../utils/reportChecks.js';
import ServicePhotos from '../components/ServicePhotos.jsx';
import ServiceProgress from '../components/ServiceProgress.jsx';
import SignaturePad from '../components/SignaturePad.jsx';
import { SignatureImage } from '@/components/signature-image';
import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { EnglishDatePicker } from '@/components/english-date-picker';
import { FileText, CircleCheck, Clock3, Search } from 'lucide-react';
import StatCard from '../components/StatCard.jsx';
import { technicianRequest } from '../services/jobService.js';
import { formatDate } from '../utils/jobs.js';
const fields = [
  ['workPerformed', 'Work performed', true],
  ['problemFound', 'Remarks / previously recorded problems', false],
  ['solutionApplied', 'Solution applied', false],
  ['checklist', 'Checks completed', true],
];
const moment = (v) =>
  v ? String(v).replace('T', ' ').slice(0, 19) : 'Not recorded';
function ReportEditor({ row, onClose, onSaved }) {
  const [data, setData] = useState(null),
    [form, setForm] = useState({}),
    [edit, setEdit] = useState(false),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [photosLocked,setPhotosLocked]=useState(false),[progressLocked,setProgressLocked]=useState(false);
  const [checks, setChecks] = useState([]);
  const pending = useRef(null);
  const [signatureReset, setSignatureReset] = useState(0);
  const contentChanged =
    data &&
    fields.some(
      ([k]) => (form[k] ?? '').trim() !== (data.report?.[k] ?? '').trim(),
    );
  function changeContent(key, value) {
    setForm((f) => ({
      ...f,
      [key]: value,
      customerSignatureUrl: '',
      technicianSignatureUrl: '',
    }));
    setSignatureReset((n) => n + 1);
  }

  const load = async () => {
    try {
      setError('');
      const d = await technicianRequest('/reports/' + row.jobId);
      setData(d);
      setChecks(parseChecks(d.report?.checklist));
      setForm(
        Object.fromEntries(
          [
            ...fields.map((f) => f[0]),
            'customerSignatureUrl',
            'technicianSignatureUrl',
          ].map((k) => [k, d.report?.[k] ?? '']),
        ),
      );
      setEdit(!d.report?.submittedAt);
      pending.current = null;
      setUncertain(false);
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, [row.jobId]);
  async function submit(e) {
    e.preventDefault();
    if (!uncertain && !checks.length) { setError('Choose a checks template before submitting.'); return; }
    setSaving(true);
    setError('');
    try {
      if (!pending.current) {
        const report = { ...form };
        for (const who of ['customer', 'technician']) {
          const key = who + 'SignatureUrl';
          if (report[key]?.startsWith('data:image/')) {
            const uploaded = await technicianRequest(
              '/reports/' + row.jobId + '/signatures/' + who,
              {
                body: {
                  image: report[key],
                  expectedVersion: data.version,
                  report: Object.fromEntries(
                    fields.map(([k]) => [k, form[k] ?? '']),
                  ),
                },
              },
            );
            report[key] = uploaded.url;
          }
        }
        pending.current = {
          requestId: crypto.randomUUID(),
          expectedVersion: data.version,
          report,
        };
      }
      await technicianRequest('/reports/' + row.jobId, {
        method: 'PUT',
        body: pending.current,
      });
      pending.current = null;
      setUncertain(false);
      await load();
      onSaved();
    } catch (e) {
      setError(e.message);
      if (pending.current && (!e.status || e.status >= 500)) setUncertain(true);
      else {
        pending.current = null;
        setUncertain(false);
      }
    } finally {
      setSaving(false);
    }
  }
  const locked = saving || uncertain || photosLocked || progressLocked;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <DialogContent className="report-dialog" showCloseButton={!locked}>
        <DialogTitle>
          {edit ? 'Complete service report' : 'Service report'} ·{' '}
          {row.reportId ? 'SR-' + row.reportId : 'WO-' + row.jobId}
        </DialogTitle>
        <DialogDescription>
          {row.customer} · {row.serviceType} · {formatDate(row.date)}
        </DialogDescription>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!data ? (
          <Button onClick={load}>Reload report</Button>
        ) : (
          <>
            <div className="report-meta">
              <span>Job: WO-{row.jobId}</span>
              <span>Submitted: {moment(data.report?.submittedAt)}</span>
              <span>Started: {moment(data.report?.startedAt)}</span>
              <span>Completed: {moment(data.report?.completedAt)}</span>
            </div>
            <ServiceProgress jobId={row.jobId} status={data.status} repairEligible={data.repairEligible} progress={data.serviceProgress} disabled={saving||uncertain||photosLocked} onLockedChange={setProgressLocked} onSaved={async()=>{const fresh=await technicianRequest('/reports/'+row.jobId);setData(current=>({...current,serviceProgress:fresh.serviceProgress,status:fresh.status,repairEligible:fresh.repairEligible}));onSaved();}}/>
            {data.serviceProgress?.visits?.length > 0 && <details><summary>Visit records ({data.serviceProgress.visits.length})</summary>{data.serviceProgress.visits.map((visit,index)=><section key={visit.id} className="rounded-lg border p-3 my-2"><h3>Visit {index+1} · {visit.outcome}</h3><p>{moment(visit.startedAt)} – {moment(visit.endedAt)}</p><p className="whitespace-pre-wrap">{visit.snapshot.checklist_result || 'No checklist recorded for this visit.'}</p><p>{visit.snapshot.problem_found}</p></section>)}</details>}
            {edit ? (
              <form onSubmit={submit} className="portal-form">
                <fieldset disabled={locked}>
                  {!checks.length && form.checklist && <p className="whitespace-pre-wrap">Previous checklist: {form.checklist}</p>}
                  <ReportChecks rows={checks} remarks={form.problemFound} onRemarksChange={value => changeContent('problemFound', value)} onChange={next => {
                    setChecks(next);
                    const summary = summarizeChecks(next);
                    setForm(f => ({ ...f, checklist: summary,
                      workPerformed: next.filter(r => r.done).map(r => r.name).join('; ') || 'No checks completed.',
                      solutionApplied: '', customerSignatureUrl: '', technicianSignatureUrl: '' }));
                    setSignatureReset(n => n + 1);
                  }}/>
                </fieldset>
                <ServicePhotos jobId={row.jobId} disabled={saving||uncertain} onLockedChange={setPhotosLocked}/>
                <fieldset disabled={locked}>
                  {contentChanged &&
                    (data.report?.customerSignatureUrl ||
                      data.report?.technicianSignatureUrl) && (
                      <p role="status" className="signature-notice">
                        Report content changed. Previous signatures have been
                        cleared. Collect new signatures before saving.
                      </p>
                    )}
                  {['customer', 'technician'].map((who) => (
                    <SignaturePad
                      key={who + '-' + signatureReset}
                      label={
                        who === 'customer'
                          ? 'Customer signature'
                          : 'Technician signature'
                      }
                      value={form[who + 'SignatureUrl']}
                      disabled={locked}
                      required={
                        contentChanged &&
                        Boolean(data.report?.[who + 'SignatureUrl'])
                      }
                      onChange={(value) =>
                        setForm((f) => ({
                          ...f,
                          [who + 'SignatureUrl']: value,
                        }))
                      }
                    />
                  ))}
                </fieldset>
                <p className="muted">
                  Submitting an in-progress report also completes its work
                  order. Review the report before signing. If signed service
                  details change, new signatures are required.
                </p>
                <div className="portal-actions">
                  <Button type="submit" disabled={saving || photosLocked}>
                    {saving
                      ? 'Saving…'
                      : uncertain
                        ? 'Retry same submission'
                        : data.report?.submittedAt
                          ? 'Save report changes'
                          : data.status === 'In Progress' ? 'Submit report & complete' : 'Submit report'}
                  </Button>
                  {!locked && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        data.report?.submittedAt ? setEdit(false) : onClose()
                      }
                    >
                      Cancel
                    </Button>
                  )}
                  {error && !locked && (
                    <Button type="button" variant="outline" onClick={load}>
                      Reload latest report
                    </Button>
                  )}
                </div>
                {uncertain && (
                  <p role="status">
                    The result could not be confirmed. Retry this same
                    submission before making more changes.
                  </p>
                )}
              </form>
            ) : (
              <>
                <div className="report-read">
                  {fields.map(([key, label]) => (
                    <section key={key}>
                      <h3>{label}</h3>
                      <p className="whitespace-pre-wrap">{data.report?.[key] || 'Not recorded'}</p>
                    </section>
                  ))}
                  <ServicePhotos jobId={row.jobId} disabled={saving||uncertain} onLockedChange={setPhotosLocked}/>
                  {['customer', 'technician'].map((who) => (
                    <section key={who}>
                      <h3>
                        {who === 'customer' ? 'Customer' : 'Technician'}{' '}
                        signature
                      </h3>
                      <SignatureImage
                        url={data.report?.[who + 'SignatureUrl']}
                        label={
                          who === 'customer'
                            ? 'Customer signature'
                            : 'Technician signature'
                        }
                      />
                    </section>
                  ))}
                </div>
                <Button onClick={() => setEdit(true)}>Edit report</Button>
              </>
            )}
            {data.history.length > 0 && (
              <details className="report-history">
                <summary>Revision history ({data.history.length})</summary>
                {data.history.map((h) => (
                  <details key={h.version}>
                    <summary>
                      Version {h.version} · {moment(h.changedAt)}
                    </summary>
                    {fields.map(([key, label]) => (
                      <p key={key}>
                        <strong>{label}:</strong>{' '}
                        {h.content[key] || 'Not recorded'}
                      </p>
                    ))}
                  </details>
                ))}
              </details>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
export default function ServiceReports({ onChanged }) {
  const [reports, setReports] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [selected, setSelected] = useState(null),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [date, setDate] = useState(''),
    [page, setPage] = useState(1);
  async function load() {
    try {
      setError('');
      setReports((await technicianRequest('/reports')).reports);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    const refresh = () => {
      if (document.visibilityState === 'visible') load();
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const filtered = reports.filter(
    (r) =>
      (!status || (r.submittedAt ? 'Submitted' : 'Pending') === status) &&
      (!date || r.date === date) &&
      `SR-${r.reportId ?? ''} WO-${r.jobId} ${r.customer}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 10)),
    current = Math.min(page, pages),
    visible = filtered.slice((current - 1) * 10, current * 10);
  return (
    <>
      <section className="stats reports-stats">
        <StatCard
          icon={FileText}
          value={reports.length}
          label="Total Reports"
        />
        <StatCard
          icon={CircleCheck}
          value={reports.filter((r) => r.submittedAt).length}
          label="Submitted"
          color="green"
        />
        <StatCard
          icon={Clock3}
          value={reports.filter((r) => !r.submittedAt).length}
          label="Pending"
          color="indigo"
        />
      </section>
      <section className="panel">
        <div className="filters">
          <label className="search">
            <Search size={17} />
            <Input
              aria-label="Search reports"
              placeholder="Search by Report ID, Job ID or customer…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <NativeSelect
            aria-label="Report status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Status: All</option>
            <option>Submitted</option>
            <option>Pending</option>
          </NativeSelect>
          <div className="report-date">
            <EnglishDatePicker
              value={date}
              onChange={(v) => {
                setDate(v);
                setPage(1);
              }}
              disableWeekends={false}
              label="Service date"
              placeholder="Date: Any"
            />
          </div>
          {(date || query || status) && (
            <Button
              variant="ghost"
              onClick={() => {
                setDate('');
                setQuery('');
                setStatus('');
                setPage(1);
              }}
            >
              Clear
            </Button>
          )}
          <Button variant="outline" onClick={load}>
            Refresh reports
          </Button>
        </div>
        {error ? (
          <p role="alert" className="empty">
            {error}
          </p>
        ) : loading ? (
          <p className="empty">Loading reports…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    'Report ID',
                    'Job ID',
                    'Customer',
                    'Service type',
                    'Service date',
                    'Status',
                    'Action',
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.jobId}>
                    <td>{r.reportId ? 'SR-' + r.reportId : 'Not submitted'}</td>
                    <td>WO-{r.jobId}</td>
                    <td>{r.customer}</td>
                    <td>{r.serviceType}</td>
                    <td>{formatDate(r.date)}</td>
                    <td>
                      <span
                        className={
                          'report-status ' +
                          (r.submittedAt ? 'submitted' : 'pending')
                        }
                      >
                        {r.submittedAt ? 'Submitted' : 'Pending'}
                      </span>
                    </td>
                    <td>
                      <Button
                        variant={r.submittedAt ? 'outline' : 'default'}
                        onClick={() => setSelected(r)}
                      >
                        {r.submittedAt ? 'View report' : 'Complete report'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && (
              <p className="empty">
                No matching reports. Reports become available when you start a
                service in My Jobs.
              </p>
            )}
          </div>
        )}
        <div className="pagination">
          <span>
            {filtered.length
              ? `${(current - 1) * 10 + 1}–${Math.min(current * 10, filtered.length)} of ${filtered.length} reports`
              : '0 reports'}
          </span>
          <div>
            <Button
              variant="outline"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </Button>
            <span>
              Page {current} of {pages}
            </span>
            <Button
              variant="outline"
              disabled={current === pages}
              onClick={() => setPage(current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </section>
      {selected && (
        <ReportEditor
          key={selected.jobId}
          row={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            load();
            onChanged();
          }}
        />
      )}
    </>
  );
}
