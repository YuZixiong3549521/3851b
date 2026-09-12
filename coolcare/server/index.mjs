import mysql from 'mysql2/promise';
import { createApp } from './app.mjs';
import { startBookingEmailWorker } from './booking-email.mjs';
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 8,
  waitForConnections: true,
  queueLimit: 50,
  dateStrings: true,
  decimalNumbers: true,
  connectTimeout: 8000,
});
const app = createApp({
  pool,
  secret: process.env.SESSION_SECRET,
  origin: process.env.WEB_ORIGIN,
  threshold: Number(process.env.LOW_STOCK_THRESHOLD || 15),
});
const port = Number(process.env.API_PORT || 3001);
const stopMailWorker = startBookingEmailWorker(pool);
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`CoolCare local API: http://127.0.0.1:${port}`),
);
async function stop() {
  server.close();
  await stopMailWorker();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
