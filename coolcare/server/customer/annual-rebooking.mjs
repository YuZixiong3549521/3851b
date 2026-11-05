import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../inventory.mjs';
import { lockCustomer, assertAddressBookingLimit, bookingIncludesCleaning } from './booking-options.mjs';
import { assertAnnualRescheduleWindow } from './annual-bookings.mjs';
import { isCalendarDate, assertRescheduleDate } from './booking-schedule.mjs';
import { bookingServiceSlot, lockServiceDates, assertTeamCapacity } from '../scheduling.mjs';
import { bookingConfirmationDeadline } from '../order-expiry.mjs';

const schema = z.object({
  preferredDate: z.string().refine(isCalendarDate, 'Choose a valid service date.'),
  timeWindow: z.enum(['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00']),
  requestId: z.uuid(),
}).strict();

// A cancelled quarterly appointment still owns one entitlement in its original
// plan. Reopening that record avoids creating another four-visit subscription.
export async function rebookAnnualVisit(pool, user, id, input) {
  const bookingId = z.coerce.number().int().positive().parse(id);
  const data = schema.parse(input);
  const hash = createHash('sha256').update(JSON.stringify({ kind: 'Rebook annual visit', bookingId, ...data })).digest('hex');
  for (let attempt = 0; attempt < 3; attempt++) {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const customer = await lockCustomer(c, user.id);
      const [[booking]] = await c.execute('SELECT * FROM booking WHERE booking_id=? AND customer_id=? FOR UPDATE', [bookingId, customer.customerId]);
      if (!booking) throw new AppError('Booking not found.', 404);
      // The generic operation receipt also protects a retry after the reopened
      // appointment has subsequently been assigned, rejected or completed.
      const [[receipt]] = await c.execute('SELECT actor_user_id,payload_hash,result_json FROM commerce_operation WHERE request_id=? FOR SHARE', [data.requestId]);
      if (receipt) {
        if (Number(receipt.actor_user_id) !== Number(user.id) || receipt.payload_hash !== hash) throw new AppError('This request ID was already used for a different operation.', 409);
        await c.commit();
        return typeof receipt.result_json === 'string' ? JSON.parse(receipt.result_json) : receipt.result_json;
      }
      // The customer and booking locks serialize changes; plan identity and
      // quarterly boundaries are immutable and need no broader write privilege.
      const [[visit]] = await c.execute('SELECT v.series_id,v.visit_number FROM annual_booking_visit v JOIN annual_booking_series s ON s.series_id=v.series_id WHERE v.booking_id=? AND s.customer_id=?', [bookingId, customer.customerId]);
      if (!visit) throw new AppError('Only an existing annual plan visit can be rebooked here.', 409);
      if (!['Cancelled', 'Rejected', 'Expired'].includes(booking.booking_status)) throw new AppError('This visit is already open or completed. Refresh its details before making changes.', 409);
      const slot = bookingServiceSlot(data.timeWindow, booking.estimated_duration_minutes);
      assertRescheduleDate(data.preferredDate, slot.start);
      await assertAnnualRescheduleWindow(c, bookingId, data.preferredDate);

      const [assignments] = await c.execute('SELECT assignment_status FROM assignment WHERE booking_id=? FOR UPDATE', [bookingId]);
      if (assignments.some(row => !['Declined', 'Reassigned', 'Cancelled'].includes(row.assignment_status))) throw new AppError('This visit still has an active assignment. Contact the service team before rebooking.', 409);
      const [work] = await c.execute(`SELECT w.current_status,
        EXISTS(SELECT 1 FROM service_report r WHERE COALESCE(r.job_id,r.archived_job_id)=w.job_id) AS hasReport,
        EXISTS(SELECT 1 FROM service_visit_record v WHERE v.job_id=w.job_id) AS hasVisit,
        EXISTS(SELECT 1 FROM inventory_transaction i WHERE i.job_id=w.job_id) AS hasInventory
        FROM work_order w WHERE w.booking_id=? FOR UPDATE`, [bookingId]);
      if (work.some(row => row.current_status !== 'Cancelled' || row.hasReport || row.hasVisit || row.hasInventory)) throw new AppError('This visit has service or inventory records. Contact the service team to arrange it safely.', 409);
      const [[settled]] = await c.execute('SELECT booking_id FROM booking_completion_reward WHERE booking_id=?', [bookingId]);
      const [[reward]] = await c.execute('SELECT status FROM reward_reservation WHERE booking_id=? FOR UPDATE', [bookingId]);
      if (settled || (reward && reward.status !== 'Released')) throw new AppError('This visit has unsettled reward records. Contact the service team before rebooking.', 409);

      const [[address]] = await c.execute('SELECT address_line FROM service_address WHERE address_id=?', [booking.address_id]);
      await assertAddressBookingLimit(c, customer.customerId, address.address_line, data.preferredDate, bookingId, { includesCleaning: await bookingIncludesCleaning(c, bookingId) });
      await lockServiceDates(c, [booking.preferred_service_date, data.preferredDate]);
      await assertTeamCapacity(c, [{ date: data.preferredDate, start: slot.start, end: slot.end, technicians: booking.required_technicians, travelBufferMinutes: booking.travel_buffer_minutes }], { excludeBookingId: bookingId });
      const deadline = await bookingConfirmationDeadline(c, bookingId);
      await c.execute(`UPDATE booking SET preferred_service_date=?,preferred_time_slot=?,slot_start=?,slot_end=?,
        booking_status='Submitted',expires_at=?,rejection_reason=NULL,rejection_version=rejection_version+1,
        admin_waiting_since=NULL,admin_waiting_reason=NULL WHERE booking_id=?`,
      [data.preferredDate, data.timeWindow, slot.start, slot.end, deadline, bookingId]);
      await c.execute('UPDATE annual_booking_visit SET scheduled_date=? WHERE booking_id=?', [data.preferredDate, bookingId]);
      await c.execute(`INSERT INTO booking_change_request(booking_id,request_type,requested_service_date,requested_time_slot,reason,request_status)
        VALUES (?,'Reschedule',?,?,?,'Approved')`, [bookingId, data.preferredDate, data.timeWindow, `Customer reopened annual visit ${visit.visit_number} within its original quarterly window; original plan and agreed service price retained.`]);
      await c.execute(`INSERT INTO booking_status_history(booking_id,old_status,new_status,changed_by_user_id,change_note)
        VALUES (?,?,'Submitted',?,?)`, [bookingId, booking.booking_status, user.id, `Customer rebooked annual visit ${visit.visit_number} from ${String(booking.preferred_service_date).slice(0, 10)} to ${data.preferredDate} ${slot.start.slice(0, 5)} - ${slot.end.slice(0, 5)} (Singapore time). Same booking and quarterly entitlement retained; awaiting confirmation. Previously returned loyalty points are not reserved again.`]);
      const result = { success: true, bookingId };
      await c.execute('INSERT INTO commerce_operation(request_id,actor_user_id,payload_hash,result_json) VALUES (?,?,?,?)', [data.requestId, user.id, hash, JSON.stringify(result)]);
      await c.commit();
      return result;
    } catch (error) {
      await c.rollback().catch(() => undefined);
      if (error.code === 'ER_LOCK_DEADLOCK' && attempt < 2) continue;
      if (error.code === 'ER_DUP_ENTRY') throw new AppError('This request ID was already used. Refresh the visit before trying again.', 409);
      throw error;
    } finally {
      c.release();
    }
  }
}
