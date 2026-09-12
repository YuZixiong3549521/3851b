import express from 'express';
import { sessionUser } from '../public-site.mjs';
import { asyncRoute, HttpError } from './errors.mjs';
import { getDemoCustomer } from './customer.mjs';
import { createBooking, getBookingReport, listBookings } from './booking-service.mjs';
import { getBookingOptions } from './booking-options.mjs';

export function createCustomerRouter(pool) {
const app = express.Router();
app.use(express.json({ limit: '32kb' }));

app.get('/health', asyncRoute(async (request, response) => {
  await pool.query('SELECT 1');
  response.json({ status: 'ok', database: 'connected' });
}));

app.use(async (req,_res,next)=>{req.customerUser=await sessionUser(pool,req,'Customer');next();});

app.get('/customer-context', asyncRoute(async (request, response) => {
  const customer = await getDemoCustomer(pool, request.customerUser.id);
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

app.get('/services', asyncRoute(async (request, response) => {
  const {services}=await getBookingOptions(pool);
  response.json({services:services.map(service=>({...service,serviceName:service.name}))});
}));

app.get('/booking-options', asyncRoute(async (request,response) => {
  const customer=await getDemoCustomer(pool,request.customerUser.id);
  response.json(await getBookingOptions(pool,customer.customerId));
}));

app.get('/bookings', asyncRoute(async (request, response) => {
  const scope = request.query.scope === 'upcoming' ? 'upcoming' : 'all';
  response.json({ bookings: await listBookings(pool, scope, request.customerUser.id) });
}));

app.get('/bookings/history', asyncRoute(async (request, response) => {
  response.json({ bookings: await listBookings(pool, 'history', request.customerUser.id) });
}));

app.get('/bookings/:bookingId/report', asyncRoute(async (request, response) => {
  const bookingId = Number(request.params.bookingId);
  if (!Number.isInteger(bookingId) || bookingId < 1) throw new HttpError(400, 'Invalid booking identifier.');
  response.json({ report: await getBookingReport(pool, bookingId, request.customerUser.id) });
}));

app.post('/bookings', asyncRoute(async (request, response) => {
  const booking = await createBooking(pool, request.body, request.customerUser.id);
  response.status(201).json({ booking });
}));

app.use((request, response) => response.status(404).json({ error: 'Endpoint not found.' }));
app.use((error, _request, response, _next) => {
  if (error instanceof HttpError || error.status) {
    return response.status(error.status).json({ error: error.message, details: error.details });
  }
  if (error?.code === 'ECONNREFUSED') {
    return response.status(503).json({ error: 'The CoolCare database is not running.' });
  }
  console.error(error);
  return response.status(500).json({ error: 'The service encountered an unexpected error.' });
});

return app;
}
