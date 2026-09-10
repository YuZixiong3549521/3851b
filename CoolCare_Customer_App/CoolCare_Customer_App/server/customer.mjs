import { config } from './config.mjs';
import { HttpError } from './errors.mjs';

export async function getDemoCustomer(executor) {
  const [rows] = await executor.execute(
    `SELECT
       c.customer_id AS customerId,
       u.user_id AS userId,
       u.full_name AS fullName,
       u.email,
       u.phone
     FROM customer c
     JOIN user_account u ON u.user_id = c.user_id
     WHERE u.email = ? AND u.status = 'Active'
     LIMIT 1`,
    [config.demoCustomerEmail],
  );

  if (rows.length === 0) {
    throw new HttpError(503, 'The demonstration customer is not available. Run the database seed script first.');
  }

  return rows[0];
}
