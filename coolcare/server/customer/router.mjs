import express from 'express';
import { sessionUser,changePublicBooking } from '../public-site.mjs';
import { ZodError } from 'zod';
import { asyncRoute, HttpError } from './errors.mjs';
import { getDemoCustomer } from './customer.mjs';
import { createBooking, getBookingReport, listBookings,getBookingDetail } from './booking-service.mjs';
import { getBookingOptions } from './booking-options.mjs';
import { createCustomerAddress,manageCustomerAddress } from './address-service.mjs';
import { updateCustomerProfile,getBookingAvailability } from './customer-management.mjs';
import { getOwnedReportPhoto } from './report-photos.mjs';

function identifier(value) {
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<1)throw new HttpError(400,'Invalid identifier.');
  return id;
}

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
     FROM service_address WHERE customer_id = ? AND is_archived=FALSE ORDER BY is_default DESC, address_id`,
    [customer.customerId],
  );
  const [units] = await pool.execute(
    `SELECT unit_id AS unitId, address_id AS addressId, brand, model, serial_number AS serialNumber,
            installation_location AS location, warranty_status AS warrantyStatus
     FROM aircon_unit WHERE customer_id = ? AND address_id IN (SELECT address_id FROM service_address WHERE is_archived=FALSE) ORDER BY unit_id`,
    [customer.customerId],
  );
  response.json({ customer, addresses, units });
}));

app.get('/services', asyncRoute(async (request, response) => {
  const {services}=await getBookingOptions(pool);
  response.json({services:services.map(service=>({...service,serviceName:service.name}))});
}));

app.post('/addresses',asyncRoute(async(request,response)=>{
  response.status(201).json({address:await createCustomerAddress(pool,request.customerUser.id,request.body)});
}));

app.patch('/profile',asyncRoute(async(request,response)=>{
  response.json({customer:await updateCustomerProfile(pool,request.customerUser.id,request.body)});
}));
app.patch('/addresses/:id',asyncRoute(async(request,response)=>{
  response.json({address:await manageCustomerAddress(pool,request.customerUser.id,request.params.id,'update',request.body)});
}));
app.patch('/addresses/:id/default',asyncRoute(async(request,response)=>{
  response.json({address:await manageCustomerAddress(pool,request.customerUser.id,request.params.id,'default')});
}));
app.delete('/addresses/:id',asyncRoute(async(request,response)=>{
  response.json(await manageCustomerAddress(pool,request.customerUser.id,request.params.id,'archive'));
}));
app.get('/booking-availability',asyncRoute(async(request,response)=>{
  response.json(await getBookingAvailability(pool,request.customerUser.id,request.query));
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

app.get('/bookings/:bookingId',asyncRoute(async(request,response)=>{
  response.json({booking:await getBookingDetail(pool,identifier(request.params.bookingId),request.customerUser.id)});
}));
app.patch('/bookings/:bookingId/status',asyncRoute(async(request,response)=>{
  response.json(await changePublicBooking(pool,request.customerUser,request.params.bookingId,'cancel',request.body));
}));
app.patch('/bookings/:bookingId/reschedule',asyncRoute(async(request,response)=>{
  response.json(await changePublicBooking(pool,request.customerUser,request.params.bookingId,'reschedule',request.body));
}));
app.get('/bookings/:bookingId/photos/:photoId',asyncRoute(async(request,response)=>{
  const path=await getOwnedReportPhoto(pool,request.customerUser.id,identifier(request.params.bookingId),identifier(request.params.photoId));
  response.set('Cache-Control','private, no-store');
  response.set('X-Content-Type-Options','nosniff');
  // Originals deliberately live under the private .local directory. The path
  // above has already passed ownership, image-extension and realpath confinement.
  response.sendFile(path,{dotfiles:'allow'});
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
  if(error instanceof ZodError)return response.status(400).json({error:'Please check the booking information.',details:error.flatten().fieldErrors});
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
