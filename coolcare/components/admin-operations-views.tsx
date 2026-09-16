'use client';

import { useRef, useState } from 'react';
import {
  CheckCircle2,
  RefreshCw,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BookingStatus } from '@/components/booking-status';
import {
  api,
  ApiError,
  errorText,
  money,
  useInventory,
  useResource,
  type AdminBooking,
  type AdminBookingDetail,
  type List,
  type StaffMember,
} from '@/lib/inventory-client';
import { LoadState, NoResults, Pager } from '@/components/inventory-ui';

const displayDate = (value: string) =>
  new Intl.DateTimeFormat('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`));
const displayMoment = (value: string | null | undefined) =>
  value ? String(value).replace('T', ' ').slice(0, 16) : 'Not recorded';

function Heading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function OrdersPage({
  mode,
  params,
}: {
  mode: 'review' | 'dispatch';
  params: URLSearchParams;
}) {
  const { go, version, refresh } = useInventory(),
    status = mode === 'review' ? 'Submitted' : 'Confirmed';
  const page = Math.max(1, Number(params.get('page') || 1)),
    query = new URLSearchParams({ status, page: String(page), pageSize: '20' });
  const resource = useResource<List<AdminBooking>>(
    `/admin/bookings?${query}`,
    version,
  );
  const data = resource.data;
  return (
    <>
      <Heading
        eyebrow={mode === 'review' ? 'ORDERS / REVIEW' : 'ORDERS / DISPATCH'}
        title={mode === 'review' ? 'Booking review' : 'Dispatch queue'}
        description={
          mode === 'review'
            ? 'Approve or reject submitted customer requests before dispatch.'
            : 'Automatically assign confirmed visits to an available technician.'
        }
        actions={
          <Button variant="outline" onClick={refresh}>
            <RefreshCw />
            Refresh
          </Button>
        }
      />
      <LoadState {...resource} />
      {data &&
        (data.rows.length ? (
          <section className="panel table-panel admin-operations-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow key={row.bookingId}>
                    <TableCell data-label="Booking">
                      <strong>
                        BK-{String(row.bookingId).padStart(4, '0')}
                      </strong>
                      <small className="block muted">
                        {money(row.totalAmount)}
                      </small>
                    </TableCell>
                    <TableCell data-label="Customer">
                      <strong>{row.customerName}</strong>
                      <small className="block muted">{row.email}</small>
                    </TableCell>
                    <TableCell data-label="Service">
                      {row.serviceName}
                      <small className="block muted">
                        {row.numberOfUnits} AC unit(s)
                      </small>
                    </TableCell>
                    <TableCell data-label="Schedule">
                      {displayDate(row.preferredDate)}
                      <small className="block muted">{row.timeSlot}</small>
                    </TableCell>
                    <TableCell data-label="Status">
                      <BookingStatus status={row.status} />
                    </TableCell>
                    <TableCell data-label="Action" className="text-right">
                      <Button
                        size="sm"
                        onClick={() => go(`/admin/orders/${row.bookingId}`)}
                      >
                        {mode === 'review' ? 'Review' : 'Open dispatch'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager
              total={data.total}
              page={data.page}
              pageSize={data.pageSize}
              onPage={(next) =>
                go(
                  `/${mode === 'review' ? 'admin/orders' : 'admin/dispatch'}?page=${next}`,
                )
              }
            />
          </section>
        ) : (
          <NoResults
            title={
              mode === 'review'
                ? 'No bookings awaiting review'
                : 'No confirmed bookings awaiting dispatch'
            }
            description={
              mode === 'review'
                ? 'New customer requests will appear here.'
                : 'Approved bookings will appear here until assigned.'
            }
          />
        ))}
    </>
  );
}

export function OrderDetails({ bookingId }: { bookingId: number }) {
  const { go, version, refresh, notify } = useInventory(),
    resource = useResource<{ booking: AdminBookingDetail }>(
      `/admin/bookings/${bookingId}`,
      version,
    ),
    booking = resource.data?.booking;
  const [reason, setReason] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const pending = useRef<{ type: string; requestId: string } | null>(null);
  async function action(
    type: 'approve' | 'reject' | 'dispatch' | 'redispatch',
  ) {
    if (type === 'reject' && reason.trim().length < 3) {
      setError('Enter a clear rejection reason for the customer.');
      return;
    }
    setBusy(type);
    setError('');
    if (pending.current?.type !== type)
      pending.current = { type, requestId: crypto.randomUUID() };
    try {
      const result = await api<{ technician?: { fullName: string } }>(
        `/admin/bookings/${bookingId}/${type}`,
        'POST',
        {
          requestId: pending.current.requestId,
          ...(type === 'reject' ? { reason: reason.trim() } : {}),
        },
      );
      pending.current = null;
      setReason('');
      notify(
        type === 'dispatch' || type === 'redispatch'
          ? `Assigned to ${result.technician?.fullName}.`
          : `Booking ${type === 'approve' ? 'approved' : 'rejected'}.`,
      );
      refresh();
    } catch (cause) {
      setError(errorText(cause));
      if (cause instanceof ApiError && cause.status < 500)
        pending.current = null;
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        onClick={() =>
          go(
            booking?.status === 'Confirmed'
              ? '/admin/dispatch'
              : '/admin/orders',
          )
        }
      >
        ← Back to orders
      </Button>
      <LoadState {...resource} />
      {booking && (
        <>
          <Heading
            eyebrow={`BOOKING / BK-${String(booking.bookingId).padStart(4, '0')}`}
            title={`${booking.customerName} · ${booking.serviceName}`}
            description={`${displayDate(booking.preferredDate)} · ${booking.timeSlot}`}
            actions={<BookingStatus status={booking.status} />}
          />
          <div className="admin-detail-grid">
            <section className="panel">
              <h2>Request details</h2>
              <dl className="data-list">
                <div>
                  <dt>Customer</dt>
                  <dd>
                    {booking.customerName}
                    <small className="block muted">
                      {booking.email}
                      {booking.phone ? ` · ${booking.phone}` : ''}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Service address</dt>
                  <dd>
                    {booking.addressLine}
                    {booking.postalCode ? `, ${booking.postalCode}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>Service</dt>
                  <dd>
                    {booking.serviceName} · {booking.numberOfUnits} AC unit(s)
                  </dd>
                </div>
                <div>
                  <dt>Estimate</dt>
                  <dd>{money(booking.totalAmount)}</dd>
                </div>
                <div>
                  <dt>Notes</dt>
                  <dd>
                    {booking.problemDescription ||
                      'No additional notes provided.'}
                  </dd>
                </div>
              </dl>
              {booking.status === 'Submitted' && (
                <div className="mt-6 space-y-3">
                  <div className="actions">
                    <Button
                      disabled={Boolean(busy)}
                      onClick={() => action('approve')}
                    >
                      <CheckCircle2 />
                      {busy === 'approve' ? 'Approving…' : 'Approve booking'}
                    </Button>
                  </div>
                  <label
                    htmlFor="booking-rejection-reason"
                    className="block text-sm font-semibold"
                  >
                    Rejection reason
                    <Textarea
                      id="booking-rejection-reason"
                      className="mt-2 min-h-24"
                      value={reason}
                      maxLength={500}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Explain why this request cannot be approved. The customer will see this message."
                    />
                  </label>
                  <Button
                    variant="destructive"
                    disabled={Boolean(busy) || reason.trim().length < 3}
                    onClick={() => action('reject')}
                  >
                    <XCircle />
                    {busy === 'reject' ? 'Rejecting…' : 'Reject booking'}
                  </Button>
                </div>
              )}
              {booking.status === 'Confirmed' && (
                <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <h3 className="font-semibold">
                    Ready for automatic dispatch
                  </h3>
                  <p className="mt-1 text-sm muted">
                    CoolCare will choose an available technician using daily
                    workload and rotation order.
                  </p>
                  <Button
                    className="mt-4"
                    disabled={Boolean(busy)}
                    onClick={() => action('dispatch')}
                  >
                    <Send />
                    {busy === 'dispatch' ? 'Assigning…' : 'Assign technician'}
                  </Button>
                </div>
              )}
              {booking.status === 'Assigned' &&
                booking.assignments[0]?.workStatus === 'Assigned' && (
                  <div className="mt-6">
                    <Button
                      variant="outline"
                      disabled={Boolean(busy)}
                      onClick={() => action('redispatch')}
                    >
                      <RefreshCw />
                      {busy === 'redispatch'
                        ? 'Reassigning…'
                        : 'Automatically redispatch'}
                    </Button>
                  </div>
                )}
              {error && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
            </section>
            <section className="panel">
              <h2>Status timeline</h2>
              <ol className="admin-timeline">
                {booking.timeline.map((item) => (
                  <li key={item.historyId}>
                    <span />
                    <div>
                      <strong>{item.status}</strong>
                      <small>
                        {displayMoment(item.changedAt)}
                        {item.changedBy ? ` · ${item.changedBy}` : ''}
                      </small>
                      <p>{item.note || 'No note recorded.'}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {booking.assignments.length > 0 && (
                <>
                  <h2 className="mt-7">Assignments</h2>
                  <ul className="tech-detail-list">
                    {booking.assignments.map((item) => (
                      <li key={item.assignmentId}>
                        <strong>{item.technicianName}</strong> ·{' '}
                        {item.workStatus}
                        <small>
                          WO-{String(item.jobId).padStart(4, '0')} ·{' '}
                          {item.status}
                        </small>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

export function StaffPage({ role }: { role: 'Admin' | 'Technician' }) {
  const { user, version, refresh, notify } = useInventory(),
    resource = useResource<{ rows: StaffMember[] }>(
      role === 'Admin' ? '/admin/admins' : '/admin/technicians',
      version,
    );
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' }),
    [busy, setBusy] = useState(false),
    [rowBusy, setRowBusy] = useState(''),
    [error, setError] = useState('');
  async function invite(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(
        `/admin/${role === 'Admin' ? 'admins' : 'technicians'}/invitations`,
        'POST',
        form,
      );
      setForm({ fullName: '', email: '', phone: '' });
      notify(`${role} invitation queued.`);
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function updateMember(
    member: StaffMember,
    patch: { availability?: string; accountStatus?: string },
  ) {
    const key = `update-${member.userId}`;
    setRowBusy(key);
    setError('');
    try {
      await api(
        role === 'Admin'
          ? `/admin/admins/${member.userId}`
          : `/admin/technicians/${member.technicianId}`,
        'PATCH',
        patch,
      );
      notify(`${member.fullName} updated.`);
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setRowBusy('');
    }
  }
  async function resend(member: StaffMember) {
    const key = `resend-${member.userId}`;
    setRowBusy(key);
    setError('');
    try {
      await api(
        `/admin/${role === 'Admin' ? 'admins' : 'technicians'}/invitations`,
        'POST',
        {
          fullName: member.fullName,
          email: member.email,
          phone: member.phone ?? '',
        },
      );
      notify(`A new ${role.toLowerCase()} invitation was queued.`);
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setRowBusy('');
    }
  }
  async function revoke(member: StaffMember) {
    if (!member.invitationId) return;
    const key = `revoke-${member.userId}`;
    setRowBusy(key);
    setError('');
    try {
      await api(`/admin/invitations/${member.invitationId}/revoke`, 'POST', {});
      notify(`Invitation for ${member.fullName} revoked.`);
      refresh();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setRowBusy('');
    }
  }
  async function transfer(member: StaffMember) {
    setError('');
    try {
      await api('/admin/owner/transfer', 'POST', {
        targetUserId: member.userId,
      });
      notify(
        `Ownership transferred to ${member.fullName}. Sign in again to refresh permissions.`,
      );
      window.location.assign('/admin/orders');
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  return (
    <>
      <Heading
        eyebrow={`TEAM / ${role.toUpperCase()}S`}
        title={role === 'Admin' ? 'Administrators' : 'Technicians'}
        description={
          role === 'Admin'
            ? 'Owner-managed administrative access.'
            : 'Invite field staff and manage their availability.'
        }
      />
      <div className="admin-staff-grid">
        <section className="panel">
          <h2>Invite {role.toLowerCase()}</h2>
          <p className="muted mt-1 text-sm">
            A single-use activation email will expire after 48 hours.
          </p>
          <form className="mt-5" onSubmit={invite}>
            <label htmlFor="staff-full-name">
              Full name
              <Input
                id="staff-full-name"
                required
                maxLength={120}
                value={form.fullName}
                onChange={(event) =>
                  setForm({ ...form, fullName: event.target.value })
                }
              />
            </label>
            <label htmlFor="staff-work-email">
              Work email
              <Input
                id="staff-work-email"
                required
                type="email"
                maxLength={255}
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
              />
            </label>
            <label htmlFor="staff-phone">
              Phone
              <Input
                id="staff-phone"
                maxLength={30}
                value={form.phone}
                onChange={(event) =>
                  setForm({ ...form, phone: event.target.value })
                }
              />
            </label>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              <Send />
              {busy ? 'Sending…' : 'Send invitation'}
            </Button>
          </form>
        </section>
        <section className="panel table-panel admin-operations-table">
          <LoadState {...resource} />
          {resource.data &&
            (resource.data.rows.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff member</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>
                      {role === 'Admin' ? 'Access' : 'Availability'}
                    </TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resource.data.rows.map((member) => {
                    const invitationOpen =
                      member.status === 'Inactive' &&
                      Boolean(member.invitationId) &&
                      !member.invitationAcceptedAt &&
                      !member.invitationRevokedAt;
                    const disabled = Boolean(rowBusy);
                    return (
                      <TableRow key={member.userId}>
                        <TableCell data-label="Staff member">
                          <strong>{member.fullName}</strong>
                          <small className="block muted">
                            {member.email}
                            {member.phone ? ` · ${member.phone}` : ''}
                          </small>
                          {role === 'Technician' && (
                            <small className="block muted">
                              {member.futureWorkOrders ?? 0} future work
                              order(s)
                            </small>
                          )}
                        </TableCell>
                        <TableCell data-label="Account">
                          {member.status === 'Inactive' ? (
                            <>
                              <span>Inactive</span>
                              <small className="block muted">
                                {invitationOpen
                                  ? `Invitation expires ${displayMoment(member.invitationExpiresAt)}`
                                  : member.invitationRevokedAt
                                    ? 'Invitation revoked'
                                    : 'Invitation unavailable'}
                              </small>
                            </>
                          ) : (
                            <NativeSelect
                              aria-label={`Account status for ${member.fullName}`}
                              value={member.status}
                              disabled={
                                disabled || member.accessLevel === 'Owner'
                              }
                              onChange={(event) =>
                                void updateMember(member, {
                                  accountStatus: event.target.value,
                                })
                              }
                            >
                              <option value="Active">Active</option>
                              <option value="Suspended">Suspended</option>
                            </NativeSelect>
                          )}
                        </TableCell>
                        <TableCell
                          data-label={
                            role === 'Admin' ? 'Access' : 'Availability'
                          }
                        >
                          {role === 'Admin' ? (
                            member.accessLevel
                          ) : (
                            <NativeSelect
                              aria-label={`Availability for ${member.fullName}`}
                              value={member.availability}
                              disabled={disabled || member.status !== 'Active'}
                              onChange={(event) =>
                                void updateMember(member, {
                                  availability: event.target.value,
                                })
                              }
                            >
                              <option value="Available">Available</option>
                              <option value="Unavailable">Unavailable</option>
                              <option value="On Leave">On Leave</option>
                            </NativeSelect>
                          )}
                        </TableCell>
                        <TableCell data-label="Action">
                          <div className="actions justify-end">
                            {member.status === 'Inactive' && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={disabled}
                                onClick={() => void resend(member)}
                              >
                                {rowBusy === `resend-${member.userId}`
                                  ? 'Sending…'
                                  : 'Resend'}
                              </Button>
                            )}
                            {invitationOpen && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={disabled}
                                onClick={() => void revoke(member)}
                              >
                                {rowBusy === `revoke-${member.userId}`
                                  ? 'Revoking…'
                                  : 'Revoke'}
                              </Button>
                            )}
                            {role === 'Admin' &&
                              user.access_level === 'Owner' &&
                              member.status === 'Active' &&
                              member.accessLevel !== 'Owner' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={disabled}
                                  onClick={() => void transfer(member)}
                                >
                                  <ShieldCheck />
                                  Transfer ownership
                                </Button>
                              )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <NoResults
                title={`No ${role.toLowerCase()} accounts`}
                description="Send the first invitation to create an account."
              />
            ))}
        </section>
      </div>
    </>
  );
}
