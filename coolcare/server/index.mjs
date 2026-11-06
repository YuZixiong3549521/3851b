import mysql from 'mysql2/promise';
import { createApp } from './app.mjs';
import { startBookingEmailWorker } from './booking-email.mjs';
import { expireSubmittedBookings } from './order-expiry.mjs';
import { productionConfig } from './production-config.mjs';
const production = process.env.NODE_ENV === 'production';
if (production) productionConfig();
if (process.env.DB_SSL !== undefined && !['true', 'false'].includes(process.env.DB_SSL))
  throw new Error('DB_SSL must be true or false.');
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
  ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: true,
    ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA } : {}) } } : {}),
});
const app = createApp({
  pool,
  secret: process.env.SESSION_SECRET,
  origin: process.env.WEB_ORIGIN,
  threshold: Number(process.env.LOW_STOCK_THRESHOLD || 15),
  production,
});
const port = Number(process.env.API_PORT || 3001);
const stopMailWorker = startBookingEmailWorker(pool);
let expiryRunning = null;
function expireRequests() {
  if (!expiryRunning) expiryRunning = expireSubmittedBookings(pool)
    .catch(error => console.error('Booking expiry check failed:', error.message))
    .finally(() => { expiryRunning = null; });
}
const expiryTimer = setInterval(expireRequests, 60000);
expiryTimer.unref();
expireRequests();
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`CoolCare ${production ? 'production' : 'local'} API: http://127.0.0.1:${port}`),
);
async function stop() {
  server.close();
  clearInterval(expiryTimer);
  await expiryRunning;
  await stopMailWorker();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
