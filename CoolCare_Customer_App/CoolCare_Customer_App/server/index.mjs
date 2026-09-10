import express from 'express';
import cors from 'cors';
import { config } from './config.mjs';
import { pool } from './db.mjs';
import { asyncRoute, HttpError } from './errors.mjs';
import { getDemoCustomer } from './customer.mjs';
import { createBooking, getBookingReport, listBookings } from './booking-service.mjs';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: config.webOrigin }));
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', asyncRoute(async (_request, response) => {
  await pool.query('SELECT 1');
  response.json({ status: 'ok', database: 'connected' });
}));

app.get('/api/customer-context', asyncRoute(async (_request, response) => {
  const customer = await getDemoCustomer(pool);
  const [addresses] = await pool.execute(
    `SELECT address_id AS addressId, address_label AS label, address_line AS addressLine,
            postal_code AS postalCode, is_default AS isDefault
     FROM service_address WHERE customer_id = ? ORDER BY is_default DESC, address_id`,
    [customer.customerId],
  );
  const [units] = await pool.execute(
    `SELECT unit_id AS unitId, address_id AS addressId, brand, model, serial_number AS serialNumber,
            installation_location AS location, warranty_status AS warrantyStatus
     FROM aircon_unit WHERE customer_id = ? ORDER BY unit_id`,
    [customer.customerId],
  );
  response.json({ customer, addresses, units });
}));

app.get('/api/services', asyncRoute(async (_request, response) => {
  const [services] = await pool.query(
    `SELECT service_id AS serviceId, service_name AS serviceName, description,
            base_price AS basePrice, estimated_duration_minutes AS durationMinutes
     FROM service_catalog WHERE service_status = 'Active' ORDER BY service_id`,
  );
  response.json({ services });
}));

app.get('/api/bookings', asyncRoute(async (request, response) => {
  const scope = request.query.scope === 'upcoming' ? 'upcoming' : 'all';
  response.json({ bookings: await listBookings(pool, scope) });
}));

app.get('/api/bookings/history', asyncRoute(async (_request, response) => {
  response.json({ bookings: await listBookings(pool, 'history') });
}));

app.get('/api/bookings/:bookingId/report', asyncRoute(async (request, response) => {
  const bookingId = Number(request.params.bookingId);
  if (!Number.isInteger(bookingId) || bookingId < 1) throw new HttpError(400, 'Invalid booking identifier.');
  response.json({ report: await getBookingReport(pool, bookingId) });
}));

app.post('/api/bookings', asyncRoute(async (request, response) => {
  const booking = await createBooking(pool, request.body);
  response.status(201).json({ booking });
}));

app.use((_request, response) => response.status(404).json({ error: 'Endpoint not found.' }));
app.use((error, _request, response, _next) => {
  if (error instanceof HttpError) {
    return response.status(error.status).json({ error: error.message, details: error.details });
  }
  if (error?.code === 'ECONNREFUSED') {
    return response.status(503).json({ error: 'The CoolCare database is not running.' });
  }
  console.error(error);
  return response.status(500).json({ error: 'The service encountered an unexpected error.' });
});

const server = app.listen(config.port, () => {
  console.log(`CoolCare API listening on http://localhost:${config.port}`);
});

async function shutdown() {
  server.close();
  await pool.end();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
