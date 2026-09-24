import { AppError } from './inventory.mjs';

export function bookingExpiryDate(now = new Date()) {
  const configured = Number(process.env.BOOKING_CONFIRMATION_HOURS ?? 48);
  const hours =
    Number.isFinite(configured) && configured >= 1 && configured <= 720
      ? configured
      : 48;
  return new Date(now.getTime() + hours * 3600000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

export async function assertBookingNotExpired(connection, booking) {
  if (booking.booking_status !== 'Submitted' || !booking.expires_at) return;
  const [[row]] = await connection.execute(
    'SELECT ? <= UTC_TIMESTAMP() AS expired',
    [booking.expires_at],
  );
  if (Number(row.expired))
    throw new AppError(
      'This request has expired. Ask the customer to create a new booking.',
      409,
    );
}

// Only requests created with a deadline participate. Historical rows remain untouched.
// The same booking lock is used by approval/dispatch, so expiry cannot undo an assignment.
export async function expireSubmittedBookings(pool, { limit = 100 } = {}) {
  const boundedLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const [candidates] = await pool.execute(
    `SELECT booking_id FROM booking WHERE booking_status='Submitted'
    AND expires_at IS NOT NULL AND expires_at<=UTC_TIMESTAMP() ORDER BY expires_at,booking_id LIMIT ?`,
    [boundedLimit],
  );
  let expired = 0;
  for (const candidate of candidates) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[booking]] = await connection.execute(
        `SELECT booking_id,booking_status,
        expires_at<=UTC_TIMESTAMP() AS overdue FROM booking WHERE booking_id=? FOR UPDATE`,
        [candidate.booking_id],
      );
      if (booking?.booking_status === 'Submitted' && Number(booking.overdue)) {
        const [assigned] = await connection.execute(
          `SELECT assignment_id FROM assignment WHERE booking_id=?
          AND assignment_status NOT IN ('Declined','Reassigned','Cancelled') FOR UPDATE`,
          [booking.booking_id],
        );
        if (!assigned.length) {
          await connection.execute(
            "UPDATE booking SET booking_status='Expired' WHERE booking_id=? AND booking_status='Submitted'",
            [booking.booking_id],
          );
          await connection.execute(
            `INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note)
            VALUES (?,'Submitted','Expired',NULL,'The request expired before confirmation. Please book a new appointment.')`,
            [booking.booking_id],
          );
          expired++;
        }
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  return { expired };
}
