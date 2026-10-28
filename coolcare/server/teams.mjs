import { AppError } from './inventory.mjs';
import { recommendedTeamSize, teamDuration } from '../lib/team-rules.mjs';
import {
  addDispatchProximity,
  compareDispatchCandidates,
} from './postal-proximity.mjs';
import { bookingServiceSlot, lockTechnicianRoster } from './scheduling.mjs';
import { travelStartTime } from './travel-planning.mjs';
export { recommendedTeamSize, teamDuration };

// Single authoritative membership predicate, including legacy lead assignments.
export function memberSql(alias, technicianExpression) {
  return `(${alias}.technician_id=${technicianExpression} OR EXISTS(SELECT 1 FROM assignment_member member WHERE member.assignment_id=${alias}.assignment_id AND member.technician_id=${technicianExpression}))`;
}
export function assignmentTeamNameSql(alias, fallback) {
  return `COALESCE((SELECT GROUP_CONCAT(CONCAT(team_user.full_name,IF(team_tech.technician_id=${alias}.technician_id,' (Lead)','')) ORDER BY team_tech.technician_id=${alias}.technician_id DESC,team_tech.technician_id SEPARATOR ', ')
    FROM technician team_tech JOIN user_account team_user ON team_user.user_id=team_tech.user_id WHERE ${memberSql(alias, 'team_tech.technician_id')}),${fallback})`;
}
export function visitTeamNameSql(alias, fallback) {
  return `COALESCE((SELECT GROUP_CONCAT(CONCAT(team_user.full_name,IF(vm.is_lead,' (Lead)','')) ORDER BY vm.is_lead DESC,vm.technician_id SEPARATOR ', ')
    FROM visit_member vm JOIN technician team_tech ON team_tech.technician_id=vm.technician_id JOIN user_account team_user ON team_user.user_id=team_tech.user_id WHERE vm.report_id=${alias}.report_id),${fallback})`;
}
export async function assignmentTeam(c, assignmentId) {
  const [rows] = await c.execute(
    `SELECT t.technician_id AS technicianId,u.full_name AS fullName,t.user_id AS userId,
    (t.technician_id=a.technician_id) AS isLead FROM assignment a JOIN technician t ON ${memberSql('a', 't.technician_id')}
    JOIN user_account u ON u.user_id=t.user_id WHERE a.assignment_id=? ORDER BY isLead DESC,t.technician_id`,
    [assignmentId],
  );
  return rows.map((r) => ({ ...r, isLead: Boolean(r.isLead) }));
}
export async function saveAssignmentTeam(c, assignmentId, ids) {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    await c.execute(
      'INSERT IGNORE INTO assignment_member(assignment_id,technician_id) VALUES (?,?)',
      [assignmentId, id],
    );
    await c.execute(
      'UPDATE technician SET last_assigned_at=UTC_TIMESTAMP() WHERE technician_id=?',
      [id],
    );
  }
}
export async function bookingTeam(c, bookingId) {
  const [[row]] = await c.execute(
    `SELECT assignment_id FROM assignment WHERE booking_id=? AND assignment_status NOT IN ('Cancelled','Reassigned','Declined') ORDER BY assignment_id DESC LIMIT 1`,
    [bookingId],
  );
  return row ? assignmentTeam(c, row.assignment_id) : [];
}
export async function captureVisitTeam(c, jobId) {
  await c.execute(
    `INSERT IGNORE INTO visit_member(report_id,technician_id,is_lead)
    SELECT r.report_id,t.technician_id,t.technician_id=a.technician_id FROM service_report r JOIN work_order w ON w.job_id=r.job_id
    JOIN assignment a ON a.assignment_id=w.assignment_id JOIN technician t ON ${memberSql('a', 't.technician_id')} WHERE w.job_id=?
    AND NOT EXISTS(SELECT 1 FROM visit_member saved WHERE saved.report_id=r.report_id)`,
    [jobId],
  );
}
export async function teamStartBlockReason(c, assignmentId, jobId) {
  const team = await assignmentTeam(c, assignmentId);
  for (const member of team) {
    const [[conflict]] = await c.execute(
      `SELECT w.job_id FROM work_order w JOIN assignment a ON a.assignment_id=w.assignment_id
      WHERE ${memberSql('a', String(Number(member.technicianId)))} AND w.current_status='In Progress' AND w.job_id<>? LIMIT 1`,
      [jobId],
    );
    if (conflict)
      return `${member.fullName}: finish work order WO-${conflict.job_id} before starting another service.`;
  }
  return null;
}
export async function assertTeamCanStart(c, assignmentId, jobId) {
  const reason = await teamStartBlockReason(c, assignmentId, jobId);
  if (reason) throw new AppError(reason, 409);
}

export async function staffingBooking(c, bookingId) {
  const [[b]] = await c.execute(
    `SELECT b.*,GREATEST(1,(SELECT COUNT(*) FROM booking_aircon_unit WHERE booking_id=b.booking_id)) AS unit_count
    FROM booking b WHERE b.booking_id=?`,
    [bookingId],
  );
  if (!b) throw new AppError('Booking not found.', 404);
  return b;
}
export function staffingDuration(b, count) {
  return b.cleaning_minutes_per_unit == null
    ? b.estimated_duration_minutes
    : teamDuration(
        b.unit_count,
        count,
        b.cleaning_minutes_per_unit,
        b.diagnostic_minutes,
      );
}
export async function teamDispatchOptions(
  c,
  b,
  count = recommendedTeamSize(b.unit_count),
) {
  if (!b.overrideSlot && staffingDuration(b, count) > 540)
    throw new AppError(
      'This team would finish after 6:00 PM. Choose more technicians or a different appointment.',
      409,
    );
  const slot =
    b.overrideSlot ??
    bookingServiceSlot(b.preferred_time_slot, staffingDuration(b, count));
  const date = String(b.preferred_service_date).slice(0, 10),
    start = travelStartTime(slot.start, b.travel_buffer_minutes);
  const [rows] = await c.execute(
    `SELECT t.technician_id AS technicianId,t.user_id AS userId,u.full_name AS fullName,u.email,u.status AS accountStatus,
    t.availability_status AS availability,t.last_assigned_at AS lastAssignedAt,t.base_postal_code AS basePostalCode,t.hourly_labor_cost AS hourlyLaborCost,
    (SELECT COUNT(*) FROM assignment a JOIN work_order w ON w.assignment_id=a.assignment_id WHERE ${memberSql('a', 't.technician_id')}
      AND DATE(w.appointment_date)=? AND a.assignment_status NOT IN ('Declined','Cancelled','Reassigned','Completed') AND w.current_status NOT IN ('Cancelled','Completed')) AS dailyJobs,
    EXISTS(SELECT 1 FROM assignment a JOIN work_order w ON w.assignment_id=a.assignment_id JOIN booking occupied ON occupied.booking_id=w.booking_id
      WHERE ${memberSql('a', 't.technician_id')} AND w.booking_id<>? AND a.assignment_status NOT IN ('Declined','Cancelled','Reassigned','Completed')
      AND w.current_status NOT IN ('Cancelled','Completed','Awaiting return arrangement') AND DATE(w.appointment_date)=?
      AND SUBTIME(occupied.slot_start,SEC_TO_TIME(COALESCE(occupied.travel_buffer_minutes,30)*60))<? AND occupied.slot_end>?) AS conflict,
    EXISTS(SELECT 1 FROM assignment a JOIN work_order w ON w.assignment_id=a.assignment_id JOIN service_progress p ON p.job_id=w.job_id JOIN booking occupied ON occupied.booking_id=w.booking_id
      WHERE ${memberSql('a', 't.technician_id')} AND w.booking_id<>? AND a.assignment_status NOT IN ('Declined','Cancelled','Reassigned')
      AND p.follow_up_status IN ('Scheduled','In Progress') AND p.follow_up_date=?
      AND SUBTIME(p.follow_up_start,SEC_TO_TIME(COALESCE(occupied.travel_buffer_minutes,30)*60))<? AND p.follow_up_end>?) AS returnConflict
    FROM technician t JOIN user_account u ON u.user_id=t.user_id JOIN role r ON r.role_id=u.role_id WHERE r.role_name='Technician'`,
    [
      date,
      b.booking_id,
      date,
      slot.end,
      start,
      b.booking_id,
      date,
      slot.end,
      start,
    ],
  );
  await addDispatchProximity(
    c,
    { ...b, slot_start: slot.start, slot_end: slot.end },
    rows,
  );
  const currentTeam = await bookingTeam(c, b.booking_id);
  for (const row of rows) {
    row.current = currentTeam.some((t) => t.technicianId === row.technicianId);
    row.reason =
      row.accountStatus !== 'Active'
        ? 'Choose a technician with an active account.'
        : row.availability === 'On Leave'
          ? 'Technician is on leave.'
          : row.availability === 'Unavailable'
            ? 'Technician is unavailable.'
            : row.conflict || row.returnConflict
              ? 'Overlapping service or travel time.'
              : null;
    row.eligible = !row.reason;
    row.dailyJobs = Number(row.dailyJobs);
  }
  rows.sort(
    (a, b) =>
      Number(!a.eligible) - Number(!b.eligible) ||
      compareDispatchCandidates(a, b),
  );
  return {
    bookingId: b.booking_id,
    status: b.booking_status,
    preferredDate: date,
    timeSlot: b.preferred_time_slot,
    slotStart: slot.start,
    slotEnd: slot.end,
    estimatedDurationMinutes: staffingDuration(b, count),
    travelBufferMinutes: Number(b.travel_buffer_minutes ?? 30),
    trafficNote: b.traffic_note,
    unitCount: Number(b.unit_count),
    requiredTechnicians: recommendedTeamSize(b.unit_count),
    teamSize: count,
    technicians: rows,
  };
}
export async function selectDispatchTeam(c, b, data) {
  await lockTechnicianRoster(c);
  const ids =
    data.mode === 'manual'
      ? [...new Set(data.technicianIds ?? [data.technicianId])]
      : null;
  if (
    ids?.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    ids?.length === 0
  )
    throw new AppError('Choose at least one technician.', 400);
  if (data.technicianIds && ids.length !== data.technicianIds.length)
    throw new AppError('Select each technician only once.', 400);
  const count = ids?.length ?? recommendedTeamSize(b.unit_count),
    options = await teamDispatchOptions(c, b, count);
  let members;
  if (ids) {
    members = ids.map((id) => {
      const member = options.technicians.find((t) => t.technicianId === id);
      if (!member) throw new AppError('Technician not found.', 409);
      if (!member.eligible)
        throw new AppError(`${member.fullName}: ${member.reason}`, 409);
      return member;
    });
  } else {
    members = options.technicians.filter((t) => t.eligible).slice(0, count);
    if (members.length < count)
      throw new AppError(
        `No technician is available for the complete team: ${count} required; only ${members.length} available. Change the appointment or use manual dispatch.`,
        409,
      );
  }
  const leadId =
    data.mode === 'manual'
      ? (data.leadTechnicianId ??
        data.technicianId ??
        (ids.length === 1 ? ids[0] : null))
      : members[0].technicianId;
  const lead = members.find((t) => t.technicianId === leadId);
  if (!lead)
    throw new AppError('Choose a lead technician from the selected team.', 400);
  return { members, lead, options };
}
