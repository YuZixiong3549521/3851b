import { pool } from './db.mjs';

try {
  const [[{ tableCount }]] = await pool.query(
    `SELECT COUNT(*) AS tableCount FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`,
  );
  const [[{ viewCount }]] = await pool.query(
    `SELECT COUNT(*) AS viewCount FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_type = 'VIEW'`,
  );
  const [[counts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM user_account) AS users,
       (SELECT COUNT(*) FROM customer) AS customers,
       (SELECT COUNT(*) FROM booking) AS bookings,
       (SELECT COUNT(*) FROM work_order) AS workOrders,
       (SELECT COUNT(*) FROM service_report) AS serviceReports`,
  );

  console.table([{ tableCount, viewCount, ...counts }]);
  if (tableCount !== 29 || viewCount !== 5 || counts.bookings < 3 || counts.serviceReports < 1) {
    throw new Error('The CoolCare database baseline is incomplete.');
  }
  console.log('CoolCare database baseline verified.');
} finally {
  await pool.end();
}
