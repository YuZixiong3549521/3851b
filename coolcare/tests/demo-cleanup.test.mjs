import test from 'node:test';
import assert from 'node:assert/strict';
import { deletionOrder, cleanupDemoOrders } from '../scripts/cleanup-demo-orders.mjs';

test('demo cleanup deletes every child before its parent, including parallel report paths', () => {
  const edges = [{ child:'work_order',parent:'booking' }, { child:'service_report',parent:'work_order' },
    { child:'photo',parent:'work_order' }, { child:'photo',parent:'service_report' }];
  const result = deletionOrder(['booking','work_order','service_report','photo'], edges);
  for (const e of edges) assert.ok(result.indexOf(e.child) < result.indexOf(e.parent));
  assert.throws(() => deletionOrder(['a','b'],[{child:'a',parent:'b'},{child:'b',parent:'a'}]), /Cyclic/);
});
test('cleanup refuses an unrecognized batch size before any delete or backup', async () => {
  const statements = [];
  const db = { beginTransaction:async()=>{}, rollback:async()=>{statements.push('rollback');},
    query:async sql => {
      statements.push(sql);
      if (sql.includes('GET_LOCK')) return [[{ acquired:1 }]];
      if (sql.includes('DATABASE() AS name')) return [[{ name:'coolcare_service_app' }]];
      if (sql.startsWith('SELECT b.*')) return [[{booking_id:1,customer_id:2}]];
      return [[]];
    } };
  await assert.rejects(cleanupDemoOrders(db,{apply:true}), /Expected exactly 300/);
  assert.ok(statements.includes('rollback'));
  assert.ok(!statements.some(sql => /^DELETE|^INSERT|^UPDATE/.test(sql)));
});
