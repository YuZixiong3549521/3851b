import { createHash,randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from './errors.mjs';
import { lockCustomer,resolveBookingSelection,assertAddressBookingLimit } from './booking-options.mjs';
import { annualVisitSchedule } from './annual-bookings.mjs';
import { assertBookableDate,isCalendarDate } from './booking-schedule.mjs';
import { addressLineSchema,findOrCreateServiceAddress,addressUnitIds } from './address-service.mjs';
import { assertTeamCapacity,normalizeBookingSlot } from '../scheduling.mjs';
import { describeCreatedBooking,writeSelectedBookings } from './booking-writer.mjs';
import { bookingReference } from './booking-service.mjs';
import { normalizePhoneNumber,phoneNumberError } from '../../lib/phone-number.mjs';

const timeWindows=['09:00 AM - 11:00 AM','11:00 AM - 01:00 PM','02:00 PM - 04:00 PM','04:00 PM - 06:00 PM','11:30 AM - 01:30 PM','04:30 PM - 06:30 PM'];
const positiveId=z.number().int().positive();
const draftSchema=z.object({
  step:z.enum(['service','units','address','schedule','review']),
  serviceId:positiveId.optional(),packageId:positiveId.optional(),
  numberOfUnits:z.number().int().min(1).max(10),
  serviceAddress:z.string().max(255),phone:z.string().max(30),
  preferredDate:z.string().max(10),timeWindow:z.union([z.enum(timeWindows),z.literal('')]),notes:z.string().max(1000),
}).strict();
const identitySchema=z.object({expectedUserId:positiveId,draftId:z.uuid(),revision:positiveId});
const saveSchema=identitySchema.extend({draftId:z.uuid().nullable(),revision:z.number().int().min(0),draft:draftSchema}).strict();
const confirmSchema=identitySchema.extend({quoteId:z.uuid()}).strict();
const readJson=value=>typeof value==='string'?JSON.parse(value):value;
const canonicalJson=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);

function fail(status,message,code,details,state) {
  const error=new HttpError(status,message,details);
  error.code=code;
  if(state!==undefined)error.state=state;
  return error;
}

function parseInput(schema,input,user) {
  const parsed=schema.safeParse(input);
  if(!parsed.success)throw fail(400,'Please check the assistant information.','VALIDATION_ERROR',{fieldErrors:z.flattenError(parsed.error).fieldErrors});
  if(parsed.data.expectedUserId!==Number(user.id))throw fail(409,'Your signed-in account changed. Reload the assistant before continuing.','ACCOUNT_CHANGED');
  return parsed.data;
}

function stateView(row,userId) {
  if(!row)return null;
  return {draftId:row.draft_id,userId:Number(userId),revision:row.revision,status:row.draft_status,requestId:row.request_id,
    draft:readJson(row.draft_data),quote:readJson(row.reviewed_quote),booking:readJson(row.booking_receipt),updatedAt:row.updated_at_iso};
}

async function currentRow(connection,customerId) {
  const [[row]]=await connection.execute("SELECT d.*,DATE_FORMAT(d.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS updated_at_iso FROM assistant_booking_draft d WHERE current_customer_id=?",[customerId]);
  return row;
}

async function ownedRow(connection,customerId,draftId) {
  const [[row]]=await connection.execute("SELECT d.*,DATE_FORMAT(d.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS updated_at_iso FROM assistant_booking_draft d WHERE draft_id=? AND customer_id=?",[draftId,customerId]);
  return row;
}

async function transaction(pool,user,action) {
  const connection=await pool.getConnection();
  try {
    // Use current committed catalogue data after its shared locks are acquired.
    // A prior draft read must not pin an older REPEATABLE READ price snapshot.
    await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await connection.beginTransaction();
    const customer=await lockCustomer(connection,user.id);
    const result=await action(connection,customer);
    await connection.commit();
    return result;
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}

async function requireCurrent(connection,customer,input,user) {
  const row=await currentRow(connection,customer.customerId);
  if(!row||row.draft_id!==input.draftId||row.revision!==input.revision) {
    throw fail(409,'This draft changed in another tab. Load the saved version before continuing.','DRAFT_CONFLICT',undefined,stateView(row,user.id));
  }
  return row;
}

function requireEditable(row,user) {
  if(row.draft_status==='completed')throw fail(409,'This booking was already created. Start another booking explicitly to create a new request.','DRAFT_CONFLICT',undefined,stateView(row,user.id));
}

function emptyDraft(user) {
  return {step:'service',numberOfUnits:2,serviceAddress:'',phone:user.phone||'',preferredDate:'',timeWindow:timeWindows[0],notes:''};
}

async function insertDraft(connection,customer,user,draft) {
  const id=randomUUID();
  await connection.execute(`INSERT INTO assistant_booking_draft(draft_id,customer_id,current_customer_id,request_id,draft_data,created_at,updated_at)
    VALUES (?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,[id,customer.customerId,customer.customerId,randomUUID(),JSON.stringify(draft)]);
  return stateView(await ownedRow(connection,customer.customerId,id),user.id);
}

export async function getAssistantDraft(pool,user) {
  const [[row]]=await pool.execute(`SELECT d.*,DATE_FORMAT(d.updated_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS updated_at_iso FROM assistant_booking_draft d JOIN customer c ON c.customer_id=d.current_customer_id WHERE c.user_id=?`,[user.id]);
  return {state:stateView(row,user.id)};
}

export async function saveAssistantDraft(pool,user,untrustedInput) {
  const input=parseInput(saveSchema,untrustedInput,user);
  return transaction(pool,user,async(connection,customer)=>{
    const current=await currentRow(connection,customer.customerId);
    if(input.draftId===null&&input.revision===0&&!current)return {state:await insertDraft(connection,customer,user,input.draft)};
    // A lost save response may be retried once with exactly the same draft. It
    // never revives an archived draft or overwrites a reviewed/completed request.
    if(current?.draft_id===input.draftId&&current.revision===input.revision+1&&current.draft_status==='editing'
      &&canonicalJson(readJson(current.draft_data))===canonicalJson(input.draft))return {state:stateView(current,user.id)};
    const row=await requireCurrent(connection,customer,input,user);
    requireEditable(row,user);
    if(canonicalJson(readJson(row.draft_data))===canonicalJson(input.draft))return {state:stateView(row,user.id)};
    await connection.execute(`UPDATE assistant_booking_draft SET revision=revision+1,draft_status='editing',draft_data=?,
      reviewed_quote=NULL,quote_fingerprint=NULL,updated_at=UTC_TIMESTAMP(3) WHERE draft_id=?`,[JSON.stringify(input.draft),row.draft_id]);
    return {state:stateView(await ownedRow(connection,customer.customerId,row.draft_id),user.id)};
  });
}

export async function newAssistantDraft(pool,user,untrustedInput) {
  const input=parseInput(identitySchema.strict(),untrustedInput,user);
  return transaction(pool,user,async(connection,customer)=>{
    const row=await requireCurrent(connection,customer,input,user);
    await connection.execute('UPDATE assistant_booking_draft SET current_customer_id=NULL,updated_at=UTC_TIMESTAMP(3) WHERE draft_id=?',[row.draft_id]);
    return {state:await insertDraft(connection,customer,user,emptyDraft(user))};
  });
}

function validateReadyDraft(draft) {
  const fieldErrors={};
  if(Boolean(draft.serviceId)===Boolean(draft.packageId))fieldErrors.serviceId=['Choose Cleaning, Repair or the Annual Cleaning Bundle.'];
  const address=addressLineSchema.safeParse(draft.serviceAddress);
  if(!address.success)fieldErrors.serviceAddress=address.error.issues.map(issue=>issue.message);
  const phoneError=phoneNumberError(draft.phone);
  if(phoneError)fieldErrors.phone=[phoneError];
  if(!timeWindows.includes(draft.timeWindow))fieldErrors.timeWindow=['Choose a preferred arrival window.'];
  if(!isCalendarDate(draft.preferredDate)||draft.preferredDate<'1000-01-07'||draft.preferredDate>'9998-12-25')fieldErrors.preferredDate=['Choose a valid first service date.'];
  if(Object.keys(fieldErrors).length)throw fail(400,'Please correct the highlighted booking details.','VALIDATION_ERROR',{fieldErrors});
  return {...draft,serviceAddress:address.data,phone:normalizePhoneNumber(draft.phone)};
}

async function lockedSelection(connection,customerId,input,requestId) {
  // Lock the catalogue rows before resolving the quote. A price editor must wait
  // until quote comparison and the booking snapshot have committed together.
  // Every assistant transaction takes these locks in the same table order.
  await connection.query('SELECT service_id FROM service_catalog ORDER BY service_id FOR SHARE');
  await connection.query('SELECT service_id FROM web_service_pricing ORDER BY service_id FOR SHARE');
  await connection.query('SELECT package_id FROM maintenance_package ORDER BY package_id FOR SHARE');
  await connection.query('SELECT package_id FROM web_package_details ORDER BY package_id FOR SHARE');
  await connection.query('SELECT package_id,service_id FROM package_service ORDER BY package_id,service_id FOR SHARE');
  await connection.query('SELECT service_id FROM simple_service_catalog ORDER BY service_id FOR SHARE');
  await connection.query('SELECT package_id FROM simple_package_catalog ORDER BY package_id FOR SHARE');
  try {
    const selection=await resolveBookingSelection(connection,customerId,{...input,requestId},input.numberOfUnits);
    const amounts=[selection.totalAmount,...selection.services.flatMap(service=>[service.basePrice,service.additionalUnitPrice,service.lineTotal])];
    if(amounts.some(amount=>!Number.isFinite(amount)||amount<0))throw new HttpError(409,'The current service price is unavailable. Please contact the service team.');
    if(selection.annual&&Number(selection.package.includedVisits)!==4)throw new HttpError(409,'The annual bundle details have changed. Please contact the service team.');
    return selection;
  }
  catch(error){if(error.status&&error.status<500)throw fail(error.status,error.message,'VALIDATION_ERROR',{fieldErrors:{[input.packageId?'packageId':'serviceId']:[error.message]}});throw error;}
}

function describeQuote(selection,input) {
  const visits=selection.annual?annualVisitSchedule(input.preferredDate,selection.totalAmount):[
    {visitNumber:1,preferredDate:input.preferredDate,totalAmount:selection.totalAmount},
  ];
  const terms={currency:'SGD',serviceName:selection.package?.name||selection.serviceName,annual:selection.annual,
    totalAmount:selection.totalAmount,numberOfUnits:input.numberOfUnits,
    services:selection.services.map(service=>({serviceId:service.serviceId,name:service.name,basePrice:service.basePrice,
      additionalUnitPrice:service.additionalUnitPrice,quantity:service.quantity,lineTotal:service.lineTotal})),
    package:selection.package?{packageId:selection.package.packageId,name:selection.package.name,price:Number(selection.package.price),
      additionalUnitPrice:Number(selection.package.additionalUnitPrice),includedUnits:selection.package.includedUnits,includedVisits:selection.package.includedVisits}:null,
    visits:visits.map(({visitNumber,preferredDate,totalAmount})=>({visitNumber,preferredDate,totalAmount})),
    serviceAddress:input.serviceAddress,timeWindow:input.timeWindow};
  const fingerprint=createHash('sha256').update(JSON.stringify(terms)).digest('hex');
  return {fingerprint,quote:{quoteId:randomUUID(),currency:terms.currency,serviceName:terms.serviceName,annual:terms.annual,
    totalAmount:terms.totalAmount,numberOfUnits:input.numberOfUnits,visits:terms.visits,reviewedAt:new Date().toISOString()}};
}

async function validateSchedule(connection,customerId,input,quote,state) {
  const conflicts=[];
  for(const visit of quote.visits) {
    try {
      assertBookableDate(visit.preferredDate);
      await assertAddressBookingLimit(connection,customerId,input.serviceAddress,visit.preferredDate);
    }catch(error){
      if(!error.status||error.status>=500)throw error;
      conflicts.push({visitNumber:visit.visitNumber,preferredDate:visit.preferredDate,message:error.message});
    }
  }
  try {
    const slot=normalizeBookingSlot(input.timeWindow);
    await assertTeamCapacity(connection,quote.visits.map(visit=>({date:visit.preferredDate,start:slot.start,end:slot.end})));
  } catch(error) {
    if(!error.status||error.status>=500)throw error;
    const capacityDates=error.capacityConflicts?.length?new Set(error.capacityConflicts.map(conflict=>conflict.date)):null;
    for(const visit of quote.visits)if((!capacityDates||capacityDates.has(visit.preferredDate))&&!conflicts.some(conflict=>conflict.visitNumber===visit.visitNumber)) {
      conflicts.push({visitNumber:visit.visitNumber,preferredDate:visit.preferredDate,message:error.message});
    }
  }
  if(conflicts.length)throw fail(409,'Some service dates are not available. Please choose another first date.','SCHEDULE_CONFLICT',{conflicts},state);
}

async function persistQuote(connection,customer,row,user,quote,fingerprint) {
  await connection.execute(`UPDATE assistant_booking_draft SET revision=revision+1,draft_status='reviewed',draft_data=JSON_SET(draft_data,'$.step','review'),reviewed_quote=?,quote_fingerprint=?,
    updated_at=UTC_TIMESTAMP(3) WHERE draft_id=?`,[JSON.stringify(quote),fingerprint,row.draft_id]);
  return stateView(await ownedRow(connection,customer.customerId,row.draft_id),user.id);
}

export async function reviewAssistantDraft(pool,user,untrustedInput) {
  const input=parseInput(identitySchema.strict(),untrustedInput,user);
  return transaction(pool,user,async(connection,customer)=>{
    const row=await requireCurrent(connection,customer,input,user);
    requireEditable(row,user);
    const draft=validateReadyDraft(readJson(row.draft_data));
    const selection=await lockedSelection(connection,customer.customerId,draft,row.request_id);
    const {quote,fingerprint}=describeQuote(selection,draft);
    await validateSchedule(connection,customer.customerId,draft,quote,stateView(row,user.id));
    return {state:await persistQuote(connection,customer,row,user,quote,fingerprint)};
  });
}

export async function confirmAssistantDraft(pool,user,untrustedInput) {
  const input=parseInput(confirmSchema,untrustedInput,user);
  return transaction(pool,user,async(connection,customer)=>{
    const owned=await ownedRow(connection,customer.customerId,input.draftId);
    // A successful confirmation is an immutable receipt. Recover it before
    // revision, quote or lead-time checks, including after starting another draft.
    if(owned?.draft_status==='completed'&&owned.booking_receipt) {
      const state=stateView(owned,user.id);
      return {state,booking:state.booking};
    }
    const row=await requireCurrent(connection,customer,input,user);
    const previousQuote=readJson(row.reviewed_quote);
    if(row.draft_status!=='reviewed'||!previousQuote||previousQuote.quoteId!==input.quoteId) {
      throw fail(409,'Review the current booking details before confirming.','REVIEW_REQUIRED',undefined,stateView(row,user.id));
    }
    // The request UUID is server-generated and unchanged throughout this draft.
    // Recover an existing booking even if a future migration needs to repair a
    // draft receipt; never allocate another request ID to an uncertain retry.
    const [[existing]]=await connection.execute(`SELECT b.booking_id FROM web_booking_details d JOIN booking b ON b.booking_id=d.booking_id
      WHERE d.request_id=? AND b.customer_id=?`,[row.request_id,customer.customerId]);
    let booking;
    if(existing) {
      const created=await describeCreatedBooking(connection,existing.booking_id);
      booking={...created,id:created.bookingId,bookingReference:bookingReference(created.bookingId,created.createdAt)};
    }
    else {
      const draft=validateReadyDraft(readJson(row.draft_data));
      const selection=await lockedSelection(connection,customer.customerId,draft,row.request_id);
      const {quote,fingerprint}=describeQuote(selection,draft);
      await validateSchedule(connection,customer.customerId,draft,quote,stateView(row,user.id));
      if(row.quote_fingerprint!==fingerprint) {
        const state=await persistQuote(connection,customer,row,user,quote,fingerprint);
        // Return a problem rather than throwing so the replacement quote commits.
        return {error:'The price or service details changed. Review the updated estimate and confirm again.',code:'REVIEW_REQUIRED',state};
      }
      const address=await findOrCreateServiceAddress(connection,customer.customerId,draft.serviceAddress);
      const unitIds=await addressUnitIds(connection,customer.customerId,address.addressId,draft.numberOfUnits);
      const created=await writeSelectedBookings(connection,selection,{customerId:customer.customerId,userId:user.id,addressId:address.addressId,
        addressLine:address.addressLine,unitIds,preferredDate:draft.preferredDate,timeSlot:draft.timeWindow,problemDescription:draft.notes,
        phone:draft.phone,specialNotes:draft.notes,requestId:row.request_id,source:'Created using the CoolCare customer assistant. Appointment awaits confirmation.'});
      booking={...created,id:created.bookingId,bookingReference:bookingReference(created.bookingId,created.createdAt)};
    }
    await connection.execute(`UPDATE assistant_booking_draft SET revision=revision+1,draft_status='completed',booking_receipt=?,
      updated_at=UTC_TIMESTAMP(3) WHERE draft_id=?`,[JSON.stringify(booking),row.draft_id]);
    return {state:stateView(await ownedRow(connection,customer.customerId,row.draft_id),user.id),booking};
  });
}
