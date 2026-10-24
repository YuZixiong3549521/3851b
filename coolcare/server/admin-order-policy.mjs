import { AppError } from './inventory.mjs';

// Call inside the transaction after locking the booking, before changing it.
// Checking work orders also protects older rows whose booking status is stale.
export async function assertAdminOrderEditable(connection, booking) {
  if (booking.booking_status === 'In Progress')
    throw new AppError('This service is in progress. Administrators can view the order but cannot change it.', 409);
  const [active] = await connection.execute(
    "SELECT job_id FROM work_order WHERE booking_id=? AND current_status='In Progress' FOR UPDATE",
    [booking.booking_id],
  );
  if (active.length)
    throw new AppError('This service is in progress. Administrators can view the order but cannot change it.', 409);
}
