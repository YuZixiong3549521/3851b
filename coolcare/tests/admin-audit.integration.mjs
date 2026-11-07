import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPrivilegedFixtureConnection } from './privileged-fixture.mjs';
import { listAdminAudit } from '../server/admin-audit.mjs';
import { bookingReference } from '../server/booking-reference.mjs';

test('operation log filters combine real stored outcomes, actors and SGT day bounds with stable pages and complete export', async () => {
  const c = await openPrivilegedFixtureConnection();
  await c.beginTransaction();
  try {
    await c.query("SET SESSION time_zone='+00:00'");
    const [[customerRole]] = await c.query("SELECT role_id FROM role WHERE role_name='Customer'");
    const [[adminRole]] = await c.query("SELECT role_id FROM role WHERE role_name='Admin'");
    const [[service]] = await c.query('SELECT service_id FROM simple_service_catalog LIMIT 1');
    const actors = [];
    for (const name of ['Audit Administrator A', 'Audit Administrator B']) {
      const [account] = await c.execute('INSERT INTO user_account(role_id,full_name,email,password_hash) VALUES (?,?,?,?)', [adminRole.role_id, name, `audit-${randomUUID()}@example.test`, 'unusable-test-password']);
      await c.execute('INSERT INTO admin_profile(user_id) VALUES (?)', [account.insertId]); actors.push(account.insertId);
    }
    const email = `audit-customer-${randomUUID()}@example.test`;
    const [user] = await c.execute("INSERT INTO user_account(role_id,full_name,email,password_hash) VALUES (?,'Audit Customer',?,'unusable-test-password')", [customerRole.role_id, email]);
    const [customer] = await c.execute('INSERT INTO customer(user_id) VALUES (?)', [user.insertId]);
    const [address] = await c.execute("INSERT INTO service_address(customer_id,address_line,postal_code) VALUES (?,'Audit rollback fixture','560123')", [customer.insertId]);
    const [booking] = await c.execute("INSERT INTO booking(customer_id,address_id,service_id,preferred_service_date,preferred_time_slot,slot_start,slot_end,booking_status,total_amount,created_at) VALUES (?,?,?,'2026-12-01','09:00 - 11:00','09:00:00','11:00:00','Rejected',100,'2025-11-01 12:00:00')", [customer.insertId, address.insertId, service.service_id]);
    const bookingId = booking.insertId, reference = bookingReference(bookingId, '2025-11-01 12:00:00');
    const fixtures = [
      { date: '2026-11-05 15:59:59', action: 'Reject', actor: actors[0], result: { reason: 'Before requested day' } },
      { date: '2026-11-05 16:00:00', action: 'Reject', actor: actors[0], result: { reason: 'Literal %_! marker', status: 'Rejected', returnedPoints: 100 } },
      { date: '2026-11-06 04:00:00', action: 'Edit rejection', actor: actors[0], result: { reason: 'Original stored explanation', version: 2 } },
      { date: '2026-11-06 04:00:00', action: 'Edit travel plan', actor: actors[1], result: { travelBufferMinutes: 30, trafficNote: 'Traffic update' } },
      { date: '2026-11-06 15:59:59', action: 'Dispatch', actor: actors[1], result: { status: 'Assigned', technicians: [{ fullName: 'Saved technician', isLead: true }] } },
      { date: '2026-11-06 16:00:00', action: 'Reject', actor: actors[0], result: { reason: 'After requested day' } },
    ];
    for (const fixture of fixtures) {
      fixture.requestId = randomUUID();
      await c.execute('INSERT INTO booking_admin_operation(request_id,booking_id,actor_user_id,operation_type,payload_hash,result_json,created_at) VALUES (?,?,?,?,?,?,?)', [fixture.requestId, bookingId, fixture.actor, fixture.action, 'a'.repeat(64), JSON.stringify(fixture.result), fixture.date]);
    }
    const filters = { bookingId: reference, from: '2026-11-06', to: '2026-11-06', sort: 'oldest' };
    const expected = fixtures.slice(1, 5).map(row => row.requestId);
    const all = await listAdminAudit(c, filters);
    assert.equal(all.total, 4);
    assert.deepEqual(all.rows.map(row => row.requestId), expected);
    assert.equal(all.rows[0].createdAt, '2026-11-05T16:00:00.000Z');
    assert.equal(all.rows[0].bookingReference, reference);
    assert.equal(all.rows[0].actorRole, 'Admin');
    assert.equal(all.rows[0].actorAccessLevel, 'Admin');
    assert.equal(all.rows[0].customerEmail, email);
    assert.ok(actors.every(id => all.actors.some(actor => actor.id === id)));
    for (let page = 1; page <= 4; page++) {
      const result = await listAdminAudit(c, { ...filters, page, pageSize: 1 });
      assert.equal(result.total, 4); assert.equal(result.rows[0].requestId, expected[page - 1]);
    }
    assert.equal((await listAdminAudit(c, { ...filters, page: 99, pageSize: 2 })).page, 2);
    assert.deepEqual((await listAdminAudit(c, { ...filters, sort: 'newest' })).rows.map(row => row.requestId), [...expected].reverse());
    const rejection = await listAdminAudit(c, { ...filters, category: 'rejection', actorId: actors[0], q: 'Original stored' });
    assert.equal(rejection.total, 1);
    assert.equal(rejection.rows[0].requestId, fixtures[2].requestId);
    assert.equal(rejection.rows[0].outcome.find(field => field.label === 'Recorded reason').value, 'Original stored explanation');
    assert.equal((await listAdminAudit(c, { ...filters, q: '%_!' })).total, 1, 'SQL wildcard characters are searched literally');
    assert.equal((await listAdminAudit(c, { ...filters, q: email })).total, 4);
    assert.equal((await listAdminAudit(c, { ...filters, q: fixtures[3].requestId })).total, 1);
    assert.equal((await listAdminAudit(c, { ...filters, q: "' OR 1=1 --" })).total, 0);
    assert.equal((await listAdminAudit(c, { ...filters, bookingId: reference.replace('2025', '2026') })).total, 0);
    const exported = await listAdminAudit(c, { ...filters, page: 3, pageSize: 1 }, { exportAll: true });
    assert.deepEqual(exported.rows.map(row => row.requestId), expected, 'export returns all matching rows, not the visible page');
    for (const timezone of ['+08:00', '-05:00']) {
      await c.query('SET SESSION time_zone=?', [timezone]);
      const shifted = await listAdminAudit(c, filters);
      assert.deepEqual(shifted.rows.map(row => row.requestId), expected, 'day filters are independent of the MySQL session timezone');
      assert.equal(shifted.rows[0].createdAt, '2026-11-05T16:00:00.000Z');
    }
  } finally { await c.rollback(); await c.end(); }
});
