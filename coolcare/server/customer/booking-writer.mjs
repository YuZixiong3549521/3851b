import { enqueueBookingEmail } from '../booking-email.mjs';
import { annualVisitSchedule } from './annual-bookings.mjs';
import { assertAddressBookingLimit,saveBookingSelection,attachBookingSelections } from './booking-options.mjs';

export async function describeCreatedBooking(connection,bookingId,{legacy=false}={}) {
  const [[row]]=await connection.execute(`SELECT booking_id AS bookingId,created_at AS createdAt,
    booking_status AS status,total_amount AS totalAmount FROM booking WHERE booking_id=?`,[bookingId]);
  const [booking]=await attachBookingSelections(connection,[row]);
  let emailNotification;
  if(!legacy) {
    const visits=booking.annualBundle?.visits??[{bookingId}];
    for(const visit of visits) {
      const notification=await enqueueBookingEmail(connection,visit.bookingId);
      if(visit.bookingId===bookingId)emailNotification=notification;
    }
  }
  return {...booking,totalAmount:booking.totalAmount==null?null:Number(booking.totalAmount),emailNotification};
}

// The caller holds the customer lock and owns the transaction for all four visits.
export async function writeSelectedBookings(connection,selection,context) {
  const schedule=selection.annual?annualVisitSchedule(context.preferredDate,selection.totalAmount):[
    {visitNumber:1,preferredDate:context.preferredDate,totalAmount:selection.totalAmount},
  ];
  if(!context.legacy)for(const visit of schedule) {
    await assertAddressBookingLimit(connection,context.customerId,context.addressLine,visit.preferredDate);
  }
  let seriesId;
  if(selection.annual) {
    const [series]=await connection.execute(`INSERT INTO annual_booking_series(customer_id,address_id,package_id,package_name,
      first_service_date,unit_count,total_amount,request_id) VALUES (?,?,?,?,?,?,?,?)`,
    [context.customerId,context.addressId,selection.package.packageId,selection.package.name,context.preferredDate,context.unitIds.length,selection.totalAmount,context.requestId]);
    seriesId=series.insertId;
  }
  let firstBookingId;
  for(const visit of schedule) {
    const [booking]=await connection.execute(`INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,
      preferred_time_slot,problem_description,booking_status,total_amount) VALUES (?,?,?,?,?,?,'Submitted',?)`,
    [context.customerId,context.addressId,selection.services[0].serviceId,visit.preferredDate,context.timeSlot,context.problemDescription||null,visit.totalAmount]);
    firstBookingId??=booking.insertId;
    for(const unitId of context.unitIds)await connection.execute('INSERT INTO booking_aircon_unit(booking_id,unit_id) VALUES (?,?)',[booking.insertId,unitId]);
    await connection.execute('INSERT INTO web_booking_details(booking_id,service_package,contact_phone,special_notes,request_id) VALUES (?,?,?,?,?)',
      [booking.insertId,selection.package?.name||context.servicePackage||selection.serviceName.slice(0,120),context.phone||null,context.specialNotes||null,visit.visitNumber===1?context.requestId||null:null]);
    await saveBookingSelection(connection,booking.insertId,{...selection,totalAmount:visit.totalAmount,services:selection.services.map(service=>({...service,lineTotal:visit.totalAmount}))});
    if(seriesId)await connection.execute(`INSERT INTO annual_booking_visit(booking_id,series_id,visit_number,scheduled_date,window_start,window_end) VALUES (?,?,?,?,?,?)`,
      [booking.insertId,seriesId,visit.visitNumber,visit.preferredDate,visit.windowStart,visit.windowEnd]);
    await connection.execute("INSERT INTO booking_status_history(booking_id,new_status,changed_by_user_id,change_note) VALUES (?,'Submitted',?,?)",
      [booking.insertId,context.userId,selection.annual?`Annual cleaning visit ${visit.visitNumber} of 4 requested; appointment awaits confirmation.`:context.source]);
  }
  return describeCreatedBooking(connection,firstBookingId,{legacy:context.legacy});
}
