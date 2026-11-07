import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPrivilegedFixtureConnection } from './privileged-fixture.mjs';
import { commerceReport } from '../server/commerce.mjs';
const epoch = stamp => Date.parse(stamp)/1000;

test('reports count quarterly entitlements, distinct customers and received feedback with Singapore boundaries and captured teams', async()=>{
 const c=await openPrivilegedFixtureConnection();await c.beginTransaction();
 try{
  const [[role]]=await c.query("SELECT role_id FROM role WHERE role_name='Customer'");
  const [[service]]=await c.query("SELECT service_id FROM simple_service_catalog WHERE code='cleaning'");
  const [[pack]]=await c.query('SELECT package_id FROM maintenance_package LIMIT 1');
  const [[admin]]=await c.query('SELECT user_id FROM admin_profile LIMIT 1');
  const [techs]=await c.query('SELECT technician_id FROM technician ORDER BY technician_id LIMIT 2');
  assert.equal(techs.length,2);
  const [u]=await c.execute('INSERT INTO user_account(role_id,full_name,email,password_hash,created_at) VALUES (?,?,?, ?,FROM_UNIXTIME(?))',[role.role_id,'Isolated report customer',randomUUID()+'@example.test','disabled',epoch('2001-12-31T16:00:00Z')]);
  const [customer]=await c.execute('INSERT INTO customer(user_id) VALUES (?)',[u.insertId]);
  const [address]=await c.execute('INSERT INTO service_address(customer_id,address_line) VALUES (?,?)',[customer.insertId,'Report integration address']);
  const [series]=await c.execute("INSERT INTO annual_booking_series(customer_id,address_id,package_id,package_name,first_service_date,unit_count,total_amount) VALUES (?,?,?,'Isolated quarterly plan','2002-01-01',1,200)",[customer.insertId,address.insertId,pack.package_id]);
  const ids=[];
  for(let i=0;i<4;i++){
   const date=`2002-${String(i*3+1).padStart(2,'0')}-01`,status=['Completed','Completed','Assigned','Cancelled'][i];
   const [b]=await c.execute("INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,booking_status,total_amount) VALUES (?,?,?,?,'09:00 - 10:00',?,50)",[customer.insertId,address.insertId,service.service_id,date,status]);ids.push(b.insertId);
   await c.execute('INSERT INTO annual_booking_visit(booking_id,series_id,visit_number,scheduled_date,window_start,window_end) VALUES (?,?,?,?,?,DATE_ADD(?,INTERVAL 3 MONTH))',[b.insertId,series.insertId,i+1,date,date,date]);
   const [a]=await c.execute("INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status) VALUES (?,?,?,?)",[b.insertId,techs[0].technician_id,admin.user_id,i<2?'Completed':i===2?'Assigned':'Cancelled']);
   // Awaiting visits use their active assignment team. Cancelled assignments must not match.
   await c.execute('INSERT INTO assignment_member(assignment_id,technician_id) VALUES (?,?)',[a.insertId,techs[1].technician_id]);
   if(i>1)continue;
   const [j]=await c.execute("INSERT INTO work_order(booking_id,assignment_id,appointment_date,current_status) VALUES (?,?,?,'Completed')",[b.insertId,a.insertId,date]);
   const [r]=await c.execute("INSERT INTO service_report(job_id,work_performed,started_at) VALUES (?,'Isolated analytics check',TIMESTAMP(?,'10:00:00'))",[j.insertId,date]);
   await c.execute("INSERT INTO performance_visit(report_id,job_id,technician_id,outcome) VALUES (?,?,?,'Completed')",[r.insertId,j.insertId,techs[0].technician_id]);
   await c.execute('INSERT INTO visit_member(report_id,technician_id,is_lead) VALUES (?,?,FALSE)',[r.insertId,techs[1].technician_id]);
   // The helper joined only the second earlier return visit. Never attribute the
   // first return to them merely because they are in the current assignment.
   const [returned]=await c.execute("INSERT INTO service_report(job_id,archived_job_id,work_performed,started_at) VALUES (NULL,?,'Prior return visit',TIMESTAMP(?,'09:00:00'))",[j.insertId,date]);
   await c.execute("INSERT INTO performance_visit(report_id,job_id,technician_id,outcome) VALUES (?,?,?,'Return required')",[returned.insertId,j.insertId,techs[0].technician_id]);
   await c.execute('INSERT INTO visit_member(report_id,technician_id,is_lead) VALUES (?,?,TRUE)',[returned.insertId,techs[0].technician_id]);
   if(i===1)await c.execute('INSERT INTO visit_member(report_id,technician_id,is_lead) VALUES (?,?,FALSE)',[returned.insertId,techs[1].technician_id]);
   await c.execute("INSERT INTO service_visit_record(job_id,report_id,technician_id,started_at,ended_at,outcome,report_snapshot) VALUES (?,?,?,TIMESTAMP(?,'09:00:00'),TIMESTAMP(?,'09:30:00'),'Return required',JSON_OBJECT())",[j.insertId,returned.insertId,techs[0].technician_id,date,date]);
   await c.execute('INSERT INTO performance_feedback(report_id,stars,version,customer_user_id,updated_at) VALUES (?,?,2,?,FROM_UNIXTIME(?))',[r.insertId,i?2:5,u.insertId,epoch('2002-04-01T00:00:00Z')]);
   // The first rating belongs to March despite a later edit; the second crosses the SGT midnight boundary.
   await c.execute("INSERT INTO performance_operation(request_id,actor_user_id,report_id,operation_kind,payload_hash,after_json,result_json,created_at) VALUES (?,?,?,'Customer feedback',?,JSON_OBJECT('version',1),JSON_OBJECT(),FROM_UNIXTIME(?))",[randomUUID(),u.insertId,r.insertId,'a'.repeat(64),epoch(i?'2002-03-31T16:00:00Z':'2002-03-31T15:59:59Z')]);
  }
  const filters={from:'2002-01-01',to:'2002-12-31',groupBy:'quarter',serviceGroup:'annual'};
  const all=await commerceReport(c,filters), audience=all.audience;
  const p=audience.annualPlans.find(p=>p.seriesId===series.insertId);
  assert.equal(p.recordedVisits,4);assert.equal(p.completed,2);assert.equal(p.awaiting,1);assert.equal(p.closed,1);
  assert.equal(audience.customers.newInPeriod,1);assert.equal(audience.customers.withBookings,1);
  assert.deepEqual(audience.periods.map(r=>r.bookingCustomers),[1,1,1,1]);
  assert.equal(audience.reviews.positive,1);assert.equal(audience.reviews.negative,1);assert.equal(audience.reviews.total,2);
  assert.deepEqual(audience.periods.map(r=>[r.positive,r.negative]),[[1,0],[0,1],[0,0],[0,0]]);
  assert.equal(audience.reviews.fallbackDates,0);
  const short=await commerceReport(c,{...filters,to:'2002-03-31'});
  assert.equal(short.audience.annualPlans[0].selectedVisits,1);assert.equal(short.audience.annualPlans[0].recordedVisits,4);
  assert.equal(short.audience.annualPlans[0].visits[3].included,false);
  const helper=await commerceReport(c,{...filters,technicianId:techs[1].technician_id});
  assert.equal(helper.audience.reviews.total,2,'ratings belong to captured visit participants');
  assert.deepEqual(helper.orders.map(o=>o.bookingId),ids.slice(0,3),'captured visits and active team assignments both include helpers; cancelled assignments do not');
  assert.equal(helper.audience.customers.withBookings,1);
  assert.deepEqual(helper.audience.periods.map(p=>p.bookingCustomers),[1,1,1,0]);
  assert.equal(helper.audience.annualPlans[0].selectedVisits,3);
  assert.equal(helper.audience.annualPlans[0].recordedVisits,4,'whole plan details retain the closed entitlement outside the report');
  assert.equal(helper.orders[0].visits,1);
  assert.equal(helper.orders[0].returns,0,'current assignment must not claim a return completed by another historical team');
  assert.equal(helper.orders[1].visits,2);
  assert.equal(helper.orders[1].returns,1);
  assert.equal(helper.summary.visits,3);
  assert.equal(helper.summary.returnOrders,1);
  // Reassignment removes the helper from the current assignment but not their historical visits.
  await c.execute("UPDATE assignment SET assignment_status='Reassigned' WHERE booking_id IN (?,?)",ids.slice(0,2));
  const historical=await commerceReport(c,{...filters,technicianId:techs[1].technician_id});
  assert.deepEqual(historical.orders.map(o=>o.bookingId),ids.slice(0,3));
  assert.equal(historical.summary.visits,3);
  assert.equal(historical.summary.returnOrders,1);
  const [[repair]]=await c.query("SELECT service_id FROM simple_service_catalog WHERE code='repair'");
  const serviceScoped=await commerceReport(c,{from:filters.from,to:filters.to,groupBy:'quarter',serviceId:repair.service_id,technicianId:techs[1].technician_id});
  assert.equal(serviceScoped.orders.length,0,'team membership never bypasses the selected service');
  assert.equal(serviceScoped.audience.reviews.total,0);
  assert.equal(serviceScoped.audience.customers.withBookings,0);
  assert.equal(serviceScoped.audience.annualPlans.length,0);
  const none=await commerceReport(c,{...filters,technicianId:4294967295});
  assert.equal(none.audience.reviews.total,0);assert.equal(none.audience.customers.withBookings,0);
  assert.equal(none.audience.customers.newInPeriod,1,'registrations explicitly ignore service and technician filters');
 }finally{await c.rollback();await c.end();}
});
