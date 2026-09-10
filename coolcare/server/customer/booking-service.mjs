import { z } from 'zod';
import { getDemoCustomer } from './customer.mjs';
import { HttpError } from './errors.mjs';
import { offers } from '../public-site.mjs';

const timeSlots = ['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00'];

export const createBookingSchema = z.object({
  serviceId: z.coerce.number().int().positive(),
  addressId: z.coerce.number().int().positive(),
  unitIds: z.array(z.coerce.number().int().positive()).min(1).max(10),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid service date.'),
  timeSlot: z.enum(timeSlots),
  problemDescription: z.string().trim().max(1000).optional().default(''),
});

export function bookingReference(bookingId, createdAt) {
  const year = String(createdAt ?? new Date().getFullYear()).slice(0, 4);
  return `BK-${year}-${String(bookingId).padStart(4, '0')}`;
}

function assertFutureDate(dateText) {
  const selected = new Date(`${dateText}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (Number.isNaN(selected.getTime()) || selected < today) {
    throw new HttpError(400, 'The preferred service date cannot be in the past.');
  }
}

export async function createBooking(pool, untrustedInput, userId) {
  const parsed = createBookingSchema.safeParse(untrustedInput);
  if (!parsed.success) {
    throw new HttpError(400, 'Please check the booking information.', z.flattenError(parsed.error).fieldErrors);
  }

  const input = parsed.data;
  assertFutureDate(input.preferredDate);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const customer = await getDemoCustomer(connection, userId);

    const [serviceRows] = await connection.execute(
      `SELECT service_id AS serviceId, service_name AS serviceName, base_price AS basePrice
       FROM service_catalog
       WHERE service_id = ? AND service_status = 'Active'
       LIMIT 1`,
      [input.serviceId],
    );
    if (serviceRows.length === 0) throw new HttpError(400, 'The selected service is not available.');

    const [addressRows] = await connection.execute(
      `SELECT address_id FROM service_address WHERE address_id = ? AND customer_id = ? LIMIT 1`,
      [input.addressId, customer.customerId],
    );
    if (addressRows.length === 0) throw new HttpError(400, 'The selected service address is not available.');

    const uniqueUnitIds = [...new Set(input.unitIds)];
    if (uniqueUnitIds.length !== input.unitIds.length) throw new HttpError(400, 'An aircon unit was selected more than once.');
    const placeholders = uniqueUnitIds.map(() => '?').join(', ');
    const [unitRows] = await connection.execute(
      `SELECT unit_id FROM aircon_unit WHERE customer_id = ? AND unit_id IN (${placeholders})`,
      [customer.customerId, ...uniqueUnitIds],
    );
    if (unitRows.length !== uniqueUnitIds.length) throw new HttpError(400, 'One or more selected aircon units are not available.');

    const offer = offers.find(item => item[0] === serviceRows[0].serviceName);
    const totalAmount = offer ? Number(serviceRows[0].basePrice) + Math.max(0, uniqueUnitIds.length - 1) * offer[2] : Number(serviceRows[0].basePrice) * uniqueUnitIds.length;
    const [result] = await connection.execute(
      `INSERT INTO booking
        (customer_id, address_id, service_id, preferred_service_date, preferred_time_slot,
         problem_description, booking_status, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, 'Submitted', ?)`,
      [
        customer.customerId,
        input.addressId,
        input.serviceId,
        input.preferredDate,
        input.timeSlot,
        input.problemDescription || null,
        totalAmount,
      ],
    );

    const unitValues = uniqueUnitIds.map((unitId) => [result.insertId, unitId]);
    await connection.query('INSERT INTO booking_aircon_unit (booking_id, unit_id) VALUES ?', [unitValues]);
    await connection.execute(
      `INSERT INTO booking_status_history
        (booking_id, old_status, new_status, changed_by_user_id, change_note)
       VALUES (?, NULL, 'Submitted', ?, 'Booking created from customer portal.')`,
      [result.insertId, customer.userId],
    );

    await connection.commit();
    return {
      bookingId: result.insertId,
      bookingReference: bookingReference(result.insertId, new Date().getFullYear()),
      status: 'Submitted',
      serviceName: serviceRows[0].serviceName,
      totalAmount,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listBookings(pool, scope = 'all', userId) {
  const customer = await getDemoCustomer(pool, userId);
  const conditions = ['b.customer_id = ?'];
  const values = [customer.customerId];
  if (scope === 'upcoming') conditions.push("b.booking_status NOT IN ('Completed', 'Cancelled')");
  if (scope === 'history') conditions.push("b.booking_status = 'Completed'");

  const [rows] = await pool.execute(
    `SELECT
       b.booking_id AS bookingId,
       b.created_at AS createdAt,
       b.preferred_service_date AS preferredDate,
       b.preferred_time_slot AS timeSlot,
       b.problem_description AS problemDescription,
       b.booking_status AS status,
       b.total_amount AS totalAmount,
       sc.service_name AS serviceName,
       sa.address_label AS addressLabel,
       sa.address_line AS addressLine,
       sa.postal_code AS postalCode,
       tech_user.full_name AS technicianName,
       sr.report_id AS reportId
     FROM booking b
     JOIN service_catalog sc ON sc.service_id = b.service_id
     JOIN service_address sa ON sa.address_id = b.address_id
     LEFT JOIN assignment a ON a.assignment_id = (
       SELECT a2.assignment_id FROM assignment a2
       WHERE a2.booking_id = b.booking_id
       ORDER BY a2.assignment_id DESC LIMIT 1
     )
     LEFT JOIN technician t ON t.technician_id = a.technician_id
     LEFT JOIN user_account tech_user ON tech_user.user_id = t.user_id
     LEFT JOIN work_order w ON w.job_id = (
       SELECT w2.job_id FROM work_order w2
       WHERE w2.booking_id = b.booking_id
       ORDER BY w2.job_id DESC LIMIT 1
     )
     LEFT JOIN service_report sr ON sr.job_id = w.job_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY b.preferred_service_date DESC, b.booking_id DESC`,
    values,
  );

  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.bookingId);
  const unitPlaceholders = ids.map(() => '?').join(', ');
  const [unitRows] = await pool.execute(
    `SELECT bau.booking_id AS bookingId, au.unit_id AS unitId, au.brand, au.model,
            au.installation_location AS location
     FROM booking_aircon_unit bau
     JOIN aircon_unit au ON au.unit_id = bau.unit_id
     WHERE bau.booking_id IN (${unitPlaceholders})
     ORDER BY au.unit_id`,
    ids,
  );
  const unitsByBooking = Map.groupBy(unitRows, (row) => row.bookingId);

  return rows.map((row) => ({
    ...row,
    bookingReference: bookingReference(row.bookingId, row.createdAt),
    units: unitsByBooking.get(row.bookingId) ?? [],
  }));
}

export async function getBookingReport(pool, bookingId, userId) {
  const customer = await getDemoCustomer(pool, userId);
  const [rows] = await pool.execute(
    `SELECT
       b.booking_id AS bookingId,
       b.created_at AS createdAt,
       b.preferred_service_date AS serviceDate,
       b.preferred_time_slot AS timeSlot,
       sc.service_name AS serviceName,
       tech_user.full_name AS technicianName,
       sr.report_id AS reportId,
       sr.work_performed AS workPerformed,
       sr.problem_found AS problemFound,
       sr.solution_applied AS solutionApplied,
       sr.checklist_result AS checklistResult,
       sr.submitted_time AS submittedTime
     FROM booking b
     JOIN service_catalog sc ON sc.service_id = b.service_id
     JOIN work_order w ON w.booking_id = b.booking_id
     JOIN service_report sr ON sr.job_id = w.job_id
     JOIN assignment a ON a.assignment_id = w.assignment_id
     JOIN technician t ON t.technician_id = a.technician_id
     JOIN user_account tech_user ON tech_user.user_id = t.user_id
     WHERE b.booking_id = ? AND b.customer_id = ?
     ORDER BY w.job_id DESC
     LIMIT 1`,
    [bookingId, customer.customerId],
  );
  if (rows.length === 0) throw new HttpError(404, 'Service report not found.');

  const [photos] = await pool.execute(
    `SELECT p.photo_id AS photoId, p.photo_url AS photoUrl, p.description, p.captured_time AS capturedTime
     FROM photo p
     JOIN work_order w ON w.job_id = p.job_id
     WHERE w.booking_id = ?
     ORDER BY p.captured_time`,
    [bookingId],
  );
  return {
    ...rows[0],
    bookingReference: bookingReference(rows[0].bookingId, rows[0].createdAt),
    photos,
  };
}
