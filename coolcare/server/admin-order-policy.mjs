import { AppError } from './inventory.mjs';

// Read-only eligibility for the form and planner. Saving still locks and
// validates the actual assignment, work, inventory and reviewed appointment.
export const assignedRescheduleCondition = (alias = 'b') => `(${alias}.booking_status='Assigned'
  AND (SELECT COUNT(*) FROM assignment ca WHERE ca.booking_id=${alias}.booking_id AND ca.assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed'))=1
  AND EXISTS(SELECT 1 FROM work_order aw JOIN assignment aa ON aa.assignment_id=aw.assignment_id
    WHERE aw.booking_id=${alias}.booking_id AND aw.current_status='Assigned' AND aa.assignment_status NOT IN ('Declined','Reassigned','Cancelled','Completed'))
  AND NOT EXISTS(SELECT 1 FROM work_order rw LEFT JOIN service_report rr ON rr.job_id=rw.job_id
    WHERE rw.booking_id=${alias}.booking_id AND (rw.current_status NOT IN ('Assigned','Cancelled') OR rr.started_at IS NOT NULL OR rr.completed_at IS NOT NULL OR rr.submitted_time IS NOT NULL
      OR EXISTS(SELECT 1 FROM inventory_transaction it WHERE it.job_id=rw.job_id))))`;

// Call inside the transaction after locking the booking, before changing it.
// Checking work orders also protects older rows whose booking status is stale.
export async function assertAdminOrderEditable(connection, booking) {
  if (booking.booking_status === 'Completed')
    throw new AppError('This service is completed. Administrators can view the order but cannot change it.', 409);
  if (booking.booking_status === 'In Progress')
    throw new AppError('This service is in progress. Administrators can view the order but cannot change it.', 409);
  const [active] = await connection.execute(
    "SELECT job_id FROM work_order WHERE booking_id=? AND current_status='In Progress' FOR UPDATE",
    [booking.booking_id],
  );
  if (active.length)
    throw new AppError('This service is in progress. Administrators can view the order but cannot change it.', 409);
}
