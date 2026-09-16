import { z } from 'zod';
import { getDemoCustomer } from './customer.mjs';
import { HttpError } from './errors.mjs';
import { lockCustomer, resolveBookingSelection, attachBookingSelections } from './booking-options.mjs';
import { writeSelectedBookings,describeCreatedBooking } from './booking-writer.mjs';
import { config } from './config.mjs';
import { isCalendarDate } from './booking-schedule.mjs';
import { addressLineSchema,findOrCreateServiceAddress,addressUnitIds } from './address-service.mjs';
import { resolveReportPhoto } from './report-photos.mjs';

const timeSlots = ['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00'];

export const createBookingSchema = z.object({
  expectedUserId: z.coerce.number().int().positive().optional(),
  serviceId: z.coerce.number().int().positive().optional(),
  serviceType: z.string().trim().min(1).max(120).optional(),
  serviceIds: z.array(z.coerce.number().int().positive()).min(1).max(10).optional(),
  packageId: z.coerce.number().int().positive().optional(),
  subscriptionId: z.coerce.number().int().positive().optional(),
  requestId: z.uuid().optional(),
  addressId: z.coerce.number().int().positive().optional(),
  unitIds: z.array(z.coerce.number().int().positive()).min(1).max(10).optional(),
  serviceAddress: addressLineSchema.optional(),
  numberOfUnits: z.coerce.number().int().min(1).max(10).optional(),
  preferredDate: z.string().refine(isCalendarDate, 'Choose a valid service date.'),
  timeSlot: z.enum(timeSlots),
  problemDescription: z.string().trim().max(1000).optional().default(''),
}).superRefine((input,context)=>{
  const countMode=input.serviceAddress!==undefined||input.numberOfUnits!==undefined;
  if(countMode) {
    if(input.serviceAddress===undefined)context.addIssue({code:'custom',path:['serviceAddress'],message:'Enter a service address.'});
    if(input.numberOfUnits===undefined)context.addIssue({code:'custom',path:['numberOfUnits'],message:'Choose the number of aircon units.'});
    if(input.unitIds!==undefined)context.addIssue({code:'custom',path:['unitIds'],message:'Choose a unit count or registered units, not both.'});
  }else {
    if(input.addressId===undefined)context.addIssue({code:'custom',path:['addressId'],message:'Choose a service address.'});
    if(input.unitIds===undefined)context.addIssue({code:'custom',path:['unitIds'],message:'Choose at least one aircon unit.'});
  }
});

export function bookingReference(bookingId, createdAt) {
  const year = String(createdAt ?? new Date().getFullYear()).slice(0, 4);
  return `BK-${year}-${String(bookingId).padStart(4, '0')}`;
}

const timestampIso=seconds=>seconds===null||seconds===undefined?null:new Date(Number(seconds)*1000).toISOString();

export async function createBooking(pool, untrustedInput, userId) {
  const parsed = createBookingSchema.safeParse(untrustedInput);
  if (!parsed.success) {
    throw new HttpError(400, 'Please check the booking information.', z.flattenError(parsed.error).fieldErrors);
  }

  const input = parsed.data;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await lockCustomer(connection,userId,config.demoCustomerEmail);
    const customer = await getDemoCustomer(connection, userId);
    if (input.expectedUserId !== undefined && input.expectedUserId !== Number(customer.userId)) {
      throw new HttpError(409, 'Your signed-in account changed. Reload before booking.');
    }
    if (input.requestId) {
      const [[existing]] = await connection.execute(`SELECT b.booking_id AS bookingId,b.created_at AS createdAt,b.booking_status AS status,b.total_amount AS totalAmount
        FROM booking b JOIN web_booking_details d ON d.booking_id=b.booking_id WHERE b.customer_id=? AND d.request_id=?`, [customer.customerId,input.requestId]);
      if (existing) {
        const booking=await describeCreatedBooking(connection,existing.bookingId);
        await connection.commit();
        return { ...booking, bookingReference:bookingReference(existing.bookingId,existing.createdAt) };
      }
    }

    let address;
    let uniqueUnitIds;
    if(input.numberOfUnits!==undefined) {
      address=await findOrCreateServiceAddress(connection,customer.customerId,input.serviceAddress,{addressId:input.addressId});
      uniqueUnitIds=await addressUnitIds(connection,customer.customerId,address.addressId,input.numberOfUnits);
    }else {
      const [[savedAddress]]=await connection.execute(`SELECT address_id AS addressId,address_line AS addressLine FROM service_address
        WHERE address_id=? AND customer_id=? AND is_archived=FALSE LIMIT 1`,[input.addressId,customer.customerId]);
      if(!savedAddress)throw new HttpError(400,'The selected service address is not available.');
      address=savedAddress;
      uniqueUnitIds=[...new Set(input.unitIds)];
      if(uniqueUnitIds.length!==input.unitIds.length)throw new HttpError(400,'An aircon unit was selected more than once.');
      const [unitRows]=await connection.execute(`SELECT unit_id FROM aircon_unit WHERE customer_id=? AND address_id=?
        AND unit_id IN (${uniqueUnitIds.map(()=>'?').join(',')})`,[customer.customerId,address.addressId,...uniqueUnitIds]);
      if(unitRows.length!==uniqueUnitIds.length)throw new HttpError(400,'One or more selected aircon units are not available.');
    }

    const selection=await resolveBookingSelection(connection,customer.customerId,input,uniqueUnitIds.length);
    const booking=await writeSelectedBookings(connection,selection,{customerId:customer.customerId,userId:customer.userId,
      addressId:address.addressId,addressLine:address.addressLine,unitIds:uniqueUnitIds,preferredDate:input.preferredDate,
      timeSlot:input.timeSlot,problemDescription:input.problemDescription,phone:customer.phone,requestId:input.requestId,source:'Created from customer portal.'});
    await connection.commit();
    return {
      ...booking,
      bookingReference: bookingReference(booking.bookingId,booking.createdAt),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function listBookings(pool, scope = 'all', userId) {
  const customer = await getDemoCustomer(pool, userId);
  const conditions = ['b.customer_id = ?'];
  const values = [customer.customerId];
  if (scope === 'upcoming') conditions.push("b.booking_status NOT IN ('Completed', 'Cancelled', 'Rejected')");
  if (scope === 'history') conditions.push("b.booking_status IN ('Completed','Cancelled','Rejected')");

  const [rows] = await pool.execute(
    `SELECT
       b.booking_id AS bookingId,
       b.address_id AS addressId,
       (SELECT COUNT(*) FROM booking_aircon_unit bu WHERE bu.booking_id=b.booking_id) AS numberOfUnits,
       (b.booking_status='Submitted' AND NOT EXISTS(SELECT 1 FROM assignment owned_assignment WHERE owned_assignment.booking_id=b.booking_id)) AS canModify,
       b.created_at AS createdAt,
       UNIX_TIMESTAMP(b.created_at) AS createdAtEpoch,
       b.preferred_service_date AS preferredDate,
       b.preferred_time_slot AS timeSlot,
       b.problem_description AS problemDescription,
       b.booking_status AS status,
       (SELECT h.change_note FROM booking_status_history h
        WHERE h.booking_id=b.booking_id AND h.new_status='Rejected'
        ORDER BY h.history_id DESC LIMIT 1) AS rejectionReason,
       b.total_amount AS totalAmount,
       sc.service_name AS serviceName,
       sa.address_label AS addressLabel,
       sa.address_line AS addressLine,
       sa.postal_code AS postalCode,
       tech_user.full_name AS technicianName,
       sr.report_id AS reportId
     FROM booking b
     JOIN service_catalog sc ON sc.service_id = b.service_id
     JOIN service_address sa ON sa.address_id = b.address_id
     LEFT JOIN assignment a ON a.assignment_id = (
       SELECT a2.assignment_id FROM assignment a2
       WHERE a2.booking_id = b.booking_id
       ORDER BY a2.assignment_id DESC LIMIT 1
     )
     LEFT JOIN technician t ON t.technician_id = a.technician_id
     LEFT JOIN user_account tech_user ON tech_user.user_id = t.user_id
     LEFT JOIN work_order w ON w.job_id = (
       SELECT w2.job_id FROM work_order w2
       WHERE w2.booking_id = b.booking_id
       ORDER BY w2.job_id DESC LIMIT 1
     )
     LEFT JOIN service_report sr ON sr.job_id = w.job_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY b.preferred_service_date DESC, b.booking_id DESC`,
    values,
  );

  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.bookingId);
  const unitPlaceholders = ids.map(() => '?').join(', ');
  const [unitRows] = await pool.execute(
    `SELECT bau.booking_id AS bookingId, au.unit_id AS unitId, au.brand, au.model,
            au.installation_location AS location
     FROM booking_aircon_unit bau
     JOIN aircon_unit au ON au.unit_id = bau.unit_id
     WHERE bau.booking_id IN (${unitPlaceholders})
     ORDER BY au.unit_id`,
    ids,
  );
  const unitsByBooking = Map.groupBy(unitRows, (row) => row.bookingId);

  return attachBookingSelections(pool, rows.map(({createdAtEpoch,...row}) => ({
    ...row,
    canModify:Boolean(row.canModify),
    createdAt:timestampIso(createdAtEpoch),
    bookingReference: bookingReference(row.bookingId, row.createdAt),
    units: unitsByBooking.get(row.bookingId) ?? [],
  })));
}

export async function getBookingDetail(pool,bookingId,userId) {
  // Reuse the list's ownership and service/package snapshots, rather than
  // returning a separate representation with different business rules.
  const booking=(await listBookings(pool,'all',userId)).find(row=>row.bookingId===bookingId);
  if(!booking)throw new HttpError(404,'Booking not found.');
  const [timelineRows]=await pool.execute(`SELECT new_status AS status,UNIX_TIMESTAMP(changed_at) AS changedAtEpoch,change_note AS remarks
    FROM booking_status_history WHERE booking_id=? ORDER BY changed_at,history_id`,[bookingId]);
  const statusTimeline=timelineRows.map(({changedAtEpoch,...event})=>({...event,changedAt:timestampIso(changedAtEpoch)}));
  return {...booking,statusTimeline};
}

export async function getBookingReport(pool, bookingId, userId) {
  const customer = await getDemoCustomer(pool, userId);
  const [rows] = await pool.execute(
    `SELECT
       b.booking_id AS bookingId,
       b.created_at AS createdAt,
       b.preferred_service_date AS serviceDate,
       b.preferred_time_slot AS timeSlot,
       sc.service_name AS serviceName,
       tech_user.full_name AS technicianName,
       sr.report_id AS reportId,
       w.job_id AS jobId,
       TIMESTAMPDIFF(MINUTE,sr.started_at,sr.completed_at) AS durationMinutes,
       sr.work_performed AS workPerformed,
       sr.problem_found AS problemFound,
       sr.solution_applied AS solutionApplied,
       sr.checklist_result AS checklistResult,
       UNIX_TIMESTAMP(sr.submitted_time) AS submittedTimeEpoch,
       ca.cleaning_method AS cleaningMethod,
       ca.assessment_note AS assessmentNote
     FROM booking b
     JOIN service_catalog sc ON sc.service_id = b.service_id
     JOIN work_order w ON w.booking_id = b.booking_id
     JOIN service_report sr ON sr.job_id = w.job_id
     LEFT JOIN work_order_cleaning_assessment ca ON ca.job_id=w.job_id
     JOIN assignment a ON a.assignment_id = w.assignment_id
     JOIN technician t ON t.technician_id = a.technician_id
     JOIN user_account tech_user ON tech_user.user_id = t.user_id
     WHERE b.booking_id = ? AND b.customer_id = ?
     ORDER BY w.job_id DESC
     LIMIT 1`,
    [bookingId, customer.customerId],
  );
  if (rows.length === 0) throw new HttpError(404, 'Service report not found.');

  const [photos] = await pool.execute(
    `SELECT p.photo_id AS photoId, p.photo_url AS photoUrl, p.description, UNIX_TIMESTAMP(p.captured_time) AS capturedTimeEpoch
     FROM photo p
     JOIN work_order w ON w.job_id = p.job_id
     WHERE w.booking_id = ? AND p.job_id = ?
     ORDER BY p.captured_time`,
    [bookingId,rows[0].jobId],
  );
  const availablePhotos=await Promise.all(photos.map(async ({capturedTimeEpoch,...photo})=>({...photo,capturedTime:timestampIso(capturedTimeEpoch),
    photoUrl:await resolveReportPhoto(photo.photoUrl)?`/api/customer/bookings/${bookingId}/photos/${photo.photoId}`:null})));
  const [partsUsed]=await pool.execute(`SELECT p.part_id AS partId,p.part_name AS partName,p.stock_unit AS unit,
    SUM(CASE WHEN it.transaction_type='Stock Out' THEN it.quantity WHEN it.transaction_type='Return' THEN -it.quantity ELSE 0 END) AS quantity
    FROM inventory_transaction it JOIN part p ON p.part_id=it.part_id WHERE it.job_id=?
    GROUP BY p.part_id,p.part_name,p.stock_unit HAVING quantity>0 ORDER BY p.part_name`,[rows[0].jobId]);
  const {jobId,submittedTimeEpoch,...reportRow}=rows[0];
  const [report] = await attachBookingSelections(pool,[{
    ...reportRow,
    submittedTime:timestampIso(submittedTimeEpoch),
    bookingReference: bookingReference(rows[0].bookingId, rows[0].createdAt),
    photos:availablePhotos,
    partsUsed:partsUsed.map(part=>({...part,quantity:Number(part.quantity)})),
  }]);
  return report;
}
