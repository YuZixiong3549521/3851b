import { AppError } from './inventory.mjs';

export const BOOKING_TIME_SLOTS = [
  {
    code: '09:00 - 11:00',
    label: '09:00 AM - 11:00 AM',
    start: '09:00:00',
    end: '11:00:00',
  },
  {
    code: '11:00 - 13:00',
    label: '11:00 AM - 01:00 PM',
    start: '11:00:00',
    end: '13:00:00',
  },
  {
    code: '14:00 - 16:00',
    label: '02:00 PM - 04:00 PM',
    start: '14:00:00',
    end: '16:00:00',
  },
  {
    code: '16:00 - 18:00',
    label: '04:00 PM - 06:00 PM',
    start: '16:00:00',
    end: '18:00:00',
  },
];

const aliases = new Map([
  ['09:00 AM - 11:00 AM', BOOKING_TIME_SLOTS[0]],
  ['09:00 - 11:00', BOOKING_TIME_SLOTS[0]],
  ['11:00 AM - 01:00 PM', BOOKING_TIME_SLOTS[1]],
  ['11:00 - 13:00', BOOKING_TIME_SLOTS[1]],
  ['02:00 PM - 04:00 PM', BOOKING_TIME_SLOTS[2]],
  ['14:00 - 16:00', BOOKING_TIME_SLOTS[2]],
  ['04:00 PM - 06:00 PM', BOOKING_TIME_SLOTS[3]],
  ['16:00 - 18:00', BOOKING_TIME_SLOTS[3]],
  [
    '11:30 AM - 01:30 PM',
    {
      code: '11:30 - 13:30',
      label: '11:30 AM - 01:30 PM',
      start: '11:30:00',
      end: '13:30:00',
    },
  ],
  [
    '04:30 PM - 06:30 PM',
    {
      code: '16:30 - 18:30',
      label: '04:30 PM - 06:30 PM',
      start: '16:30:00',
      end: '18:30:00',
    },
  ],
]);

export const capacityStatuses = [
  'Submitted',
  'Confirmed',
  'Assigned',
  'On The Way',
  'In Progress',
];

export function normalizeBookingSlot(value) {
  const slot = aliases.get(String(value || '').trim());
  if (!slot)
    throw new AppError('Choose one of the available service time slots.', 400);
  return slot;
}

export function slotColumns(value) {
  const slot = normalizeBookingSlot(value);
  return { slotStart: slot.start, slotEnd: slot.end };
}

export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return String(aStart) < String(bEnd) && String(aEnd) > String(bStart);
}

export async function lockTechnicianRoster(executor) {
  await executor.execute(
    'SELECT lock_id FROM technician_capacity_lock WHERE lock_id=1 FOR UPDATE',
  );
}

export async function lockServiceDates(connection, dates) {
  const unique = [
    ...new Set(dates.map((value) => String(value).slice(0, 10))),
  ].sort((left, right) => left.localeCompare(right));
  for (const date of unique) {
    await connection.execute(
      'INSERT INTO service_day_capacity_lock(service_date) VALUES (?) ON DUPLICATE KEY UPDATE service_date=VALUES(service_date)',
      [date],
    );
  }
  if (unique.length) {
    await connection.query(
      `SELECT service_date FROM service_day_capacity_lock WHERE service_date IN (${unique.map(() => '?').join(',')}) ORDER BY service_date FOR UPDATE`,
      unique,
    );
  }
}

export async function eligibleTechnicianCount(executor) {
  await lockTechnicianRoster(executor);
  const [rows] =
    await executor.execute(`SELECT t.technician_id FROM technician t JOIN user_account u ON u.user_id=t.user_id
    WHERE u.status='Active' AND t.availability_status NOT IN ('Unavailable','On Leave') ORDER BY t.technician_id FOR UPDATE`);
  return rows.length;
}

export async function activeReservationCount(
  executor,
  { date, start, end, excludeBookingId = 0 },
) {
  const [rows] = await executor.execute(
    `SELECT b.booking_id FROM booking b
    WHERE b.preferred_service_date=? AND b.booking_status IN ('Submitted','Confirmed','Assigned','On The Way','In Progress')
    AND b.booking_id<>? AND b.slot_start IS NOT NULL AND b.slot_end IS NOT NULL
    AND b.slot_start<? AND b.slot_end>? ORDER BY b.booking_id FOR UPDATE`,
    [date, excludeBookingId, end, start],
  );
  return rows.length;
}

// The caller owns the transaction. Locking service dates in a stable order
// serializes customer submissions, reschedules and dispatch operations.
export async function assertTeamCapacity(
  connection,
  visits,
  { excludeBookingId = 0 } = {},
) {
  const normalized = visits.map((visit) => {
    const slot =
      visit.start && visit.end ? visit : normalizeBookingSlot(visit.timeSlot);
    return {
      date: String(visit.date).slice(0, 10),
      start: slot.start,
      end: slot.end,
    };
  });
  await lockServiceDates(
    connection,
    normalized.map((visit) => visit.date),
  );
  const technicianCount = await eligibleTechnicianCount(connection);
  if (!technicianCount)
    throw new AppError(
      'No technicians are currently available for booking.',
      409,
    );
  const proposed = [],
    conflicts = [];
  for (const visit of normalized) {
    const reserved = await activeReservationCount(connection, {
      ...visit,
      excludeBookingId,
    });
    const sameRequest = proposed.filter(
      (other) =>
        other.date === visit.date &&
        intervalsOverlap(other.start, other.end, visit.start, visit.end),
    ).length;
    if (reserved + sameRequest >= technicianCount) {
      conflicts.push({ ...visit, reserved, capacity: technicianCount });
    } else {
      proposed.push(visit);
    }
  }
  if (conflicts.length) {
    const error = new AppError(
      'This service time is fully booked. Choose another available time.',
      409,
    );
    error.capacityConflicts = conflicts;
    throw error;
  }
  return { technicianCount, visits: normalized };
}

export async function getTeamSlotAvailability(executor, dates) {
  const unique = [...new Set(dates.map((value) => String(value).slice(0, 10)))];
  const technicianCount = await eligibleTechnicianCount(executor);
  const result = [];
  for (const date of unique) {
    const slots = [];
    for (const slot of BOOKING_TIME_SLOTS) {
      const reserved = await activeReservationCount(executor, {
        date,
        start: slot.start,
        end: slot.end,
      });
      slots.push({
        code: slot.code,
        label: slot.label,
        available: technicianCount > reserved,
      });
    }
    result.push({ date, slots });
  }
  return { dates: result };
}
