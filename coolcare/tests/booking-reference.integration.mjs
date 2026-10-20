import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPrivilegedFixtureConnection } from './privileged-fixture.mjs';
import { bookingReference } from '../server/booking-reference.mjs';
import { getAdminBooking, listAdminBookings, listAdminSchedule } from '../server/admin-operations.mjs';
import { listAdminAudit } from '../server/admin-workspace.mjs';
import { rewardsSummary, commerceReport } from '../server/commerce.mjs';
import { listBookings, getBookingDetail } from '../server/customer/booking-service.mjs';
import { getTechnicianJobs } from '../server/technician.mjs';
import { getReport } from '../server/technician-pages.mjs';
import { listReturns } from '../server/return-visits.mjs';
import { listPerformance } from '../server/performance.mjs';
import { enqueueBookingLifecycleEmail } from '../server/booking-email.mjs';
import { getAssistantDraft } from '../server/customer/assistant-workflow.mjs';

test('all portals retain the creation-year reference, search verifies the year, and visits share an order', async () => {
  const c = await openPrivilegedFixtureConnection();
  await c.beginTransaction();
  try {
    const [[role]] = await c.query("SELECT role_id FROM role WHERE role_name='Customer'");
    const [[admin]] = await c.query('SELECT user_id FROM admin_profile LIMIT 1');
    const [[tech]] = await c.query('SELECT technician_id,user_id FROM technician LIMIT 1');
    const [[service]] = await c.query('SELECT service_id FROM simple_service_catalog LIMIT 1');
    const [user] = await c.execute("INSERT INTO user_account(role_id,full_name,email,password_hash,phone) VALUES (?,'Reference test',?,'unusable-test-password','91234567')", [role.role_id, `reference-${randomUUID()}@example.test`]);
    const [customer] = await c.execute('INSERT INTO customer(user_id) VALUES (?)', [user.insertId]);
    const [address] = await c.execute("INSERT INTO service_address(customer_id,address_line,postal_code) VALUES (?,'Reference test address','560123')", [customer.insertId]);
    const [booking] = await c.execute("INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,slot_start,slot_end,booking_status,total_amount,created_at) VALUES (?,?,?,'2025-10-20','09:00 - 11:00','09:00:00','11:00:00','Completed',100,'2024-12-31 12:00:00')", [customer.insertId, address.insertId, service.service_id]);
    const id = booking.insertId, reference = bookingReference(id, '2024-12-31 12:00:00');
    const legacyReceipt = JSON.stringify({ id, bookingId: id, status: 'Completed', annualBundle: { visits: [{ bookingId: id }] } });
    await c.execute("INSERT INTO assistant_booking_draft(draft_id,customer_id,current_customer_id,request_id,draft_data,draft_status,booking_receipt) VALUES (?,?,?,?,'{}','completed',?)", [randomUUID(), customer.insertId, customer.insertId, randomUUID(), legacyReceipt]);
    const restored = (await getAssistantDraft(c, { id: user.insertId })).state.booking;
    assert.equal(restored.bookingReference, reference);
    assert.equal(restored.annualBundle.visits[0].bookingReference, reference);
    const [[saved]] = await c.execute('SELECT booking_receipt FROM assistant_booking_draft WHERE current_customer_id=?', [customer.insertId]);
    assert.deepEqual(typeof saved.booking_receipt === 'string' ? JSON.parse(saved.booking_receipt) : saved.booking_receipt, JSON.parse(legacyReceipt));
    const [assignment] = await c.execute("INSERT INTO assignment(booking_id,technician_id,assigned_by_admin_id,assignment_status) VALUES (?,?,?,'Assigned')", [id, tech.technician_id, admin.user_id]);
    const [job] = await c.execute("INSERT INTO work_order(booking_id,assignment_id,appointment_date,appointment_time,current_status) VALUES (?,?,'2025-10-20','09:00:00','Completed')", [id, assignment.insertId]);
    await c.execute("INSERT INTO service_progress(job_id,follow_up_status) VALUES (?,'Required')", [job.insertId]);
    for (let visit = 0; visit < 2; visit++) {
      const [report] = await c.execute("INSERT INTO service_report(job_id,archived_job_id,work_performed,started_at,completed_at) VALUES (?,?,'Reference test visit','2025-10-20 09:00:00','2025-10-20 10:00:00')", [visit ? job.insertId : null, visit ? null : job.insertId]);
      await c.execute("INSERT INTO performance_visit(report_id,job_id,technician_id,scheduled_start,actual_start,actual_end,outcome) VALUES (?,?,?,'2025-10-20 09:00:00','2025-10-20 09:00:00','2025-10-20 10:00:00','Completed')", [report.insertId, job.insertId, tech.technician_id]);
    }
    const [wallet] = await c.execute('INSERT INTO loyalty_account(customer_id,current_points) VALUES (?,100)', [customer.insertId]);
    await c.execute("INSERT INTO loyalty_transaction(loyalty_account_id,booking_id,transaction_type,points,description) VALUES (?,?,'Earned',100,'Reference test earning')", [wallet.insertId, id]);
    await c.execute("INSERT INTO loyalty_transaction(loyalty_account_id,transaction_type,points,description) VALUES (?,'Adjusted',10,'Reference test account adjustment')", [wallet.insertId]);
    await c.execute("INSERT INTO booking_admin_operation(request_id,booking_id,actor_user_id,operation_type,payload_hash,result_json) VALUES (?,?,?,'Dispatch',?,?)", [randomUUID(), id, admin.user_id, 'a'.repeat(64), '{}']);

    assert.equal((await getAdminBooking(c, id)).bookingReference, reference);
    assert.equal((await getBookingDetail(c, id, user.insertId)).bookingReference, reference);
    assert.equal((await listBookings(c, 'all', user.insertId)).find(b => b.bookingId === id).bookingReference, reference);
    for (const query of [reference, reference.toLowerCase(), String(id), `#${id}`, `BK-${String(id).padStart(4, '0')}`]) {
      const result = await listAdminBookings(c, { q: query });
      assert.equal(result.total, 1);
      assert.equal(result.rows[0].bookingReference, reference);
      const audit = await listAdminAudit(c, { bookingId: query });
      assert.equal(audit.rows[0].bookingReference, reference);
    }
    const wrongYear = reference.replace('2024', '2025');
    assert.equal((await listAdminBookings(c, { q: wrongYear })).total, 0);
    assert.equal((await listAdminAudit(c, { bookingId: wrongYear })).total, 0);
    assert.equal((await listAdminSchedule(c, { from: '2025-10-20', to: '2025-10-20' })).rows.find(b => b.bookingId === id).bookingReference, reference);
    const rewards = await rewardsSummary(c, customer.insertId);
    assert.equal(rewards.bookings[0].bookingReference, reference);
    assert.equal(rewards.history.find(h => h.bookingId === id).bookingReference, reference);
    assert.equal(rewards.history.find(h => h.type === 'Adjusted').bookingId, null);
    const filters = { from: '2025-10-20', to: '2025-10-20' };
    assert.equal((await commerceReport(c, filters)).orders.find(b => b.bookingId === id).bookingReference, reference);
    assert.equal((await getTechnicianJobs(c, tech.technician_id, job.insertId))[0].bookingReference, reference);
    assert.equal((await getReport(c, tech.user_id, job.insertId)).bookingReference, reference);
    assert.equal((await listReturns(c, 'customer', user.insertId)).rows[0].bookingReference, reference);
    const visits = (await listPerformance(c, { role: 'Customer', id: user.insertId }, filters)).visits;
    assert.equal(visits.length, 2);
    assert.ok(visits.every(v => v.bookingReference === reference));
    // Booking ownership still governs reads even when the reference is known.
    const [[other]] = await c.execute('SELECT user_id FROM customer WHERE customer_id<>? LIMIT 1', [customer.insertId]);
    await assert.rejects(getBookingDetail(c, id, other.user_id), error => [403, 404].includes(error.status));
    await enqueueBookingLifecycleEmail(c, id, 'booking.assigned', { technicianName: 'Reference technician' });
    const [[email]] = await c.execute('SELECT subject,body_text,body_html FROM booking_email_outbox WHERE booking_id=?', [id]);
    for (const content of Object.values(email)) assert.ok(content.includes(reference));
    // Replanning a visit across years must not rename the original booking.
    await c.execute("UPDATE booking SET preferred_service_date='2027-01-04' WHERE booking_id=?", [id]);
    assert.equal((await getAdminBooking(c, id)).bookingReference, reference);
  } finally {
    await c.rollback();
    await c.end();
  }
});
