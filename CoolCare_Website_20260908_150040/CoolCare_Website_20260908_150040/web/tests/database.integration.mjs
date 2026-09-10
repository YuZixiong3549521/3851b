import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { savePart, recordTransaction } from '../server/inventory.mjs';
import { createApp } from '../server/app.mjs';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 4,
  dateStrings: true,
  decimalNumbers: true,
});
after(() => pool.end());
// The service uses a normal DB transaction, but its commit is intercepted so every
// test mutation is rolled back. Imported data is never edited by these tests.
async function rollbackTest(work) {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  const handle = {
    execute: conn.execute.bind(conn),
    beginTransaction: () => conn.query('SAVEPOINT inventory_test_operation'),
    commit: () => conn.query('RELEASE SAVEPOINT inventory_test_operation'),
    rollback: () =>
      conn.query('ROLLBACK TO SAVEPOINT inventory_test_operation'),
    release: () => {},
  };
  try {
    await work({ getConnection: async () => handle }, conn);
  } finally {
    await conn.rollback();
    conn.release();
  }
}
test('read imported inventory and verify seeded demo login hash', async () => {
  const [parts] = await pool.query(
    'SELECT part_name,current_stock FROM part WHERE part_id IN (1,2,3) ORDER BY part_id',
  );
  assert.equal(parts.length, 3);
  const [[admin]] = await pool.query(
    "SELECT u.user_id,u.password_hash FROM user_account u JOIN admin_profile a ON u.user_id=a.user_id WHERE email='norshida@coolcare.demo'",
  );
  assert.ok(admin);
  assert.equal(
    await bcrypt.compare('CoolCareDemo2026!', admin.password_hash),
    true,
  );
});
test('real MySQL part editing, stock operations and retries (rolled back)', async () => {
  await rollbackTest(async (testPool, conn) => {
    const [[admin]] = await conn.query(
      'SELECT user_id FROM admin_profile ORDER BY user_id LIMIT 1',
    );
    const original = {
      part_name: 'TEST rollback ' + randomUUID(),
      unit_price: '18.00',
      status: 'Active',
    };
    const created = await savePart(testPool, original);
    await savePart(
      testPool,
      { ...original, unit_price: '20.00', original },
      created.part_id,
    );
    await assert.rejects(
      savePart(
        testPool,
        { ...original, unit_price: '21.00', original },
        created.part_id,
      ),
      /edited elsewhere/,
    );
    const receive = {
      request_id: randomUUID(),
      part_id: created.part_id,
      transaction_type: 'Stock In',
      quantity: 10,
      expected_stock: 0,
      remarks: 'Rolled-back test',
    };
    const first = await recordTransaction(testPool, receive, admin.user_id);
    assert.equal(first.stock_after, 10);
    const again = await recordTransaction(testPool, receive, admin.user_id);
    assert.equal(again.replayed, true);
    assert.equal(again.transaction_id, first.transaction_id);
    await assert.rejects(
      recordTransaction(testPool, { ...receive, quantity: 20 }, admin.user_id),
      /already used/,
    );
    await assert.rejects(
      recordTransaction(
        testPool,
        { ...receive, request_id: randomUUID(), expected_stock: 0 },
        admin.user_id,
      ),
      /Stock changed/,
    );
    await assert.rejects(
      recordTransaction(
        testPool,
        {
          ...receive,
          request_id: randomUUID(),
          transaction_type: 'Stock Out',
          quantity: 11,
          expected_stock: 10,
        },
        admin.user_id,
      ),
      /Not enough stock/,
    );
    const out = await recordTransaction(
      testPool,
      {
        ...receive,
        request_id: randomUUID(),
        transaction_type: 'Stock Out',
        quantity: 3,
        expected_stock: 10,
      },
      admin.user_id,
    );
    assert.equal(out.stock_after, 7);
    const adjusted = await recordTransaction(
      testPool,
      {
        ...receive,
        request_id: randomUUID(),
        transaction_type: 'Adjustment',
        direction: 'Decrease',
        quantity: 2,
        expected_stock: 7,
        remarks: 'Test correction',
      },
      admin.user_id,
    );
    assert.equal(adjusted.stock_after, 5);
    const returned = await recordTransaction(
      testPool,
      {
        ...receive,
        request_id: randomUUID(),
        transaction_type: 'Return',
        quantity: 1,
        expected_stock: 5,
      },
      admin.user_id,
    );
    assert.equal(returned.stock_after, 6);
    const [[part]] = await conn.query(
      'SELECT current_stock FROM part WHERE part_id=?',
      [created.part_id],
    );
    assert.equal(part.current_stock, 6);
    const [[ledger]] = await conn.query(
      'SELECT COUNT(*) AS n FROM inventory_transaction WHERE part_id=?',
      [created.part_id],
    );
    assert.equal(ledger.n, 4);
    // Force a failure BETWEEN the audit insert and stock update. Both must undo.
    const normal = await testPool.getConnection();
    const failingPool = {
      getConnection: async () => ({
        ...normal,
        execute: async (sql, values) => {
          if (sql.startsWith('INSERT INTO inventory_web_operation'))
            throw new Error('Injected audit failure');
          return normal.execute(sql, values);
        },
      }),
    };
    await assert.rejects(
      recordTransaction(
        failingPool,
        { ...receive, request_id: randomUUID(), expected_stock: 6 },
        admin.user_id,
      ),
      /Injected audit failure/,
    );
    const [[afterFailure]] = await conn.query(
      'SELECT current_stock FROM part WHERE part_id=?',
      [created.part_id],
    );
    const [[afterLedger]] = await conn.query(
      'SELECT COUNT(*) AS n FROM inventory_transaction WHERE part_id=?',
      [created.part_id],
    );
    assert.equal(afterFailure.current_stock, 6);
    assert.equal(afterLedger.n, 4);
  });
});
test('HTTP session, authorization, searches, exports and validation', async () => {
  const server = createApp({ pool, secret: process.env.SESSION_SECRET }).listen(
    0,
    '127.0.0.1',
  );
  await new Promise((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = '',
    csrf = '';
  async function request(path, method = 'GET', body) {
    const r = await fetch(origin + path, {
      method,
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get('set-cookie'))
      cookie = r.headers.get('set-cookie').split(';')[0];
    return r;
  }
  try {
    assert.equal((await request('/api/parts')).status, 401);
    const session = await (await request('/api/session')).json();
    csrf = session.csrf;
    const login = await request('/api/login', 'POST', {
      email: 'norshida@coolcare.demo',
      password: 'CoolCareDemo2026!',
    });
    assert.equal(login.status, 200);
    csrf = (await login.json()).csrf;
    const overview = await (await request('/api/overview')).json();
    assert.ok(overview.summary.total_parts >= 3);
    const parts = await (
      await request('/api/parts?q=Aircon&pageSize=10')
    ).json();
    assert.ok(parts.rows.some((p) => p.part_name === 'Aircon Filter'));
    assert.equal((await request('/api/parts/99999999')).status, 404);
    assert.equal((await request('/api/parts?sort=DROP%20TABLE')).status, 400);
    assert.equal(
      (await request('/api/transactions?from=2026-02-31')).status,
      400,
    );
    assert.equal(
      (
        await request('/api/parts', 'POST', {
          part_name: 'bad',
          unit_price: '-1',
          status: 'Active',
        })
      ).status,
      400,
    );
    const exported = await request('/api/parts/export');
    assert.equal(exported.status, 200);
    assert.ok((await exported.text()).includes('Aircon Filter'));
    const badOrigin = await fetch(origin + '/api/parts', {
      headers: { Origin: 'https://untrusted.example', Cookie: cookie },
    });
    assert.equal(badOrigin.status, 403);
    const goodCsrf = csrf;
    csrf = 'wrong';
    assert.equal((await request('/api/logout', 'POST', {})).status, 403);
    csrf = goodCsrf;
    assert.equal((await request('/api/logout', 'POST', {})).status, 200);
    assert.equal((await request('/api/parts')).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
