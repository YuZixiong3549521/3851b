import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDateBoundary, auditOutcome, auditQuery, auditSqlFilters, listAdminAudit } from '../server/admin-audit.mjs';

test('operation filters validate real dates, ranges, category/action combinations and safe paging', () => {
  assert.equal(auditQuery.parse({}).pageSize, 25);
  assert.equal(auditQuery.parse({ from: '2028-02-29', to: '2028-02-29' }).from, '2028-02-29');
  for (const input of [
    { from: '2026-02-29' }, { to: '2026-13-01' }, { from: '2026-11-08', to: '2026-11-07' },
    { category: 'dispatch', action: 'Reject' }, { action: "Reject' OR 1=1 --" },
    { sort: 'created_at; DROP TABLE booking' }, { actorId: '1 OR 1=1' }, { actorId: -1 },
    { bookingId: 'BK-2026-3 OR 1=1' }, { q: ['a', 'b'] }, { q: 'x'.repeat(121) },
    { page: 0 }, { pageSize: 101 }, { actorId: ['7'] }, { page: ['2'] }, { pageSize: ['25'] }, { unknownFilter: 'x' },
  ]) assert.equal(auditQuery.safeParse(input).success, false, JSON.stringify(input));
  assert.equal(auditQuery.parse({ category: 'rejection', action: 'Reject', actorId: '7', page: '2' }).actorId, 7);
});

test('Singapore whole-day bounds include midnight and exclude the following midnight', () => {
  const start = auditDateBoundary('2026-11-07'), end = auditDateBoundary('2026-11-07', true);
  assert.equal(new Date(start * 1000).toISOString(), '2026-11-06T16:00:00.000Z');
  assert.equal(new Date(end * 1000).toISOString(), '2026-11-07T16:00:00.000Z');
  assert.equal(end - start, 86400);
  assert.equal(auditDateBoundary('2028-02-29', true), auditDateBoundary('2028-03-01'));
});

test('combined operation filters bind reference year, actor and literal search without SQL interpolation', () => {
  const query = auditQuery.parse({ bookingId: 'BK-2025-0042', actorId: '7', category: 'rejection', from: '2026-11-07', to: '2026-11-07', q: "%'_! OR 1=1 --" });
  const { clause, values } = auditSqlFilters(query);
  assert.match(clause, /YEAR\(b.created_at\)=\?/);
  assert.match(clause, /o.actor_user_id=\?/);
  assert.match(clause, /o.created_at>=FROM_UNIXTIME\(\?\)/);
  assert.match(clause, /o.created_at<FROM_UNIXTIME\(\?\)/);
  assert.ok(!clause.includes(query.q));
  assert.deepEqual(values.slice(0, 5), [42, 2025, 'Reject', 'Edit rejection', 7]);
  assert.equal(values.at(-1), "%!%'!_!! OR 1=1 --%");
  assert.equal(values.slice(-5).every(value => value === values.at(-1)), true);
});

test('operation details show recorded business outcomes without exposing unknown data or inventing prior values', () => {
  const details = auditOutcome(JSON.stringify({ status: 'Rejected', reason: 'No available team', returnedPoints: 100,
    queued: false, technicians: [{ fullName: 'Technician A', isLead: true }, { fullName: 'Technician B' }],
    payload_hash: 'private', password: 'hidden', before: { status: 'Submitted' } }));
  assert.deepEqual(details, [
    { label: 'Recorded status', value: 'Rejected' }, { label: 'Recorded reason', value: 'No available team' },
    { label: 'Points returned', value: '100' }, { label: 'Waiting dispatch', value: 'No' },
    { label: 'Assigned team', value: 'Technician A (Lead), Technician B' },
  ]);
  assert.deepEqual(auditOutcome({ reason: null, status: {}, technicians: [null, { fullName: 3 }] }), []);
  for (const invalid of [null, '{}', 'not json', '[]']) assert.deepEqual(auditOutcome(invalid), []);
});

test('oversized audit export fails before returning a misleading partial CSV', async () => {
  let queries = 0;
  await assert.rejects(listAdminAudit({ execute: async () => { queries++; return [[{ total: 10001 }]]; } }, {}, { exportAll: true }), error => error.status === 400 && /Narrow the filters/.test(error.message));
  assert.equal(queries, 1);
});
