import mysql from 'mysql2/promise';
import { resolve } from 'node:path';

const id = Number(process.argv[2]);
if (!Number.isSafeInteger(id) || id < 1) {
  console.error('Usage: node coolcare/scripts/verify-booking.mjs <bookingId>');
  process.exit(1);
}
process.loadEnvFile(resolve(import.meta.dirname, '../.env.local'));
const connection = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, dateStrings: true, decimalNumbers: true,
});
try {
  console.log(`Direct MySQL SELECT — database: ${process.env.DB_NAME}, booking_id: ${id}`);
  const [bookings] = await connection.execute(
    `SELECT b.booking_id, b.customer_id, s.service_name, b.preferred_service_date,
            b.booking_status, b.total_amount, b.created_at, d.request_id, d.special_notes
     FROM booking b JOIN service_catalog s ON s.service_id=b.service_id
     LEFT JOIN web_booking_details d ON d.booking_id=b.booking_id WHERE b.booking_id=?`, [id]);
  console.table(bookings);
  if (!bookings.length) process.exitCode = 1;
  for (const table of ['booking_aircon_unit', 'booking_status_history']) {
    const [rows] = await connection.query('SELECT * FROM ?? WHERE booking_id=?', [table, id]);
    console.log(table); console.table(rows);
  }
} finally { await connection.end(); }
