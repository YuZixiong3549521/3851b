import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createApp } from '../server/app.mjs';
import { openPrivilegedFixtureConnection } from './privileged-fixture.mjs';

const protectedRoutes = {
  Customer: '/api/customer/bookings',
  Technician: '/api/technician/jobs',
  Admin: '/api/overview',
};
const password = 'PortalSessionTest2026!';

// Only isolated accounts are inserted. The same connection serves real HTTP
// requests inside an outer rollback transaction, leaving existing data intact.
async function withPortalFixture(work) {
  const connection = await openPrivilegedFixtureConnection();
  let server;
  try {
    await connection.beginTransaction();
    const hash = await bcrypt.hash(password, 4);
    const accounts = {};
    for (const role of Object.keys(protectedRoutes)) {
      const [[roleRow]] = await connection.execute(
        'SELECT role_id FROM role WHERE role_name=?', [role],
      );
      assert.ok(roleRow, `The ${role} role must be installed.`);
      const email = `portal-${role.toLowerCase()}-${randomUUID()}@example.test`;
      const [account] = await connection.execute(
        'INSERT INTO user_account(role_id,full_name,email,password_hash) VALUES (?,?,?,?)',
        [roleRow.role_id, `Portal ${role} Test`, email, hash],
      );
      const table = { Customer: 'customer', Technician: 'technician', Admin: 'admin_profile' }[role];
      await connection.execute(`INSERT INTO ${table}(user_id) VALUES (?)`, [account.insertId]);
      accounts[role] = { id: account.insertId, email, password };
    }
    server = createApp({ pool: connection, secret: process.env.SESSION_SECRET }).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    let cookie = '', csrf = '';
    const client = {
      get cookie() { return cookie; },
      get csrf() { return csrf; },
      async request(path, { method = 'GET', body, token = csrf, sessionCookie = cookie } = {}) {
        const headers = { Cookie: sessionCookie, 'Content-Type': 'application/json' };
        if (token !== null) headers['X-CSRF-Token'] = token;
        const response = await fetch(base + path, {
          method, headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return response;
      },
      async login(role) {
        const sessionResponse = await this.request('/api/session');
        assert.equal(sessionResponse.status, 200);
        csrf = (await sessionResponse.json()).csrf;
        const response = await this.request('/api/public/login', { method: 'POST', body: accounts[role] });
        assert.equal(response.status, 200);
        const login = await response.json();
        assert.equal(login.user.role, role);
        assert.equal(login.user.id, accounts[role].id);
        csrf = login.csrf;
        return login.user;
      },
    };
    await work(client, accounts);
  } finally {
    try {
      if (server) await new Promise((resolve) => server.close(resolve));
    } finally {
      try { await connection.rollback(); } finally { await connection.end(); }
    }
  }
}

for (const role of Object.keys(protectedRoutes)) {
  test(`${role}: common logout requires CSRF, revokes the session, and prevents old-cookie reuse`, async () => {
    await withPortalFixture(async (client, accounts) => {
      await client.login(role);
      assert.equal((await client.request(protectedRoutes[role])).status, 200);
      for (const [otherRole, path] of Object.entries(protectedRoutes)) {
        if (otherRole === role) continue;
        const response = await client.request(path);
        assert.ok([401, 403].includes(response.status), `${role} cannot access ${otherRole}.`);
      }
      for (const token of [null, 'invalid-csrf-token']) {
        assert.equal((await client.request('/api/logout', { method: 'POST', body: {}, token })).status, 403);
        assert.equal((await client.request(protectedRoutes[role])).status, 200,
          'A rejected logout must leave the authenticated session intact.');
        const session = await (await client.request('/api/public/session')).json();
        assert.equal(session.user.id, accounts[role].id);
      }
      const oldCookie = client.cookie;
      const response = await client.request('/api/logout', { method: 'POST', body: {} });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
      assert.match(response.headers.get('set-cookie'), /^coolcare\.sid=;/);
      for (const path of Object.values(protectedRoutes)) {
        assert.equal((await client.request(path)).status, 401);
        assert.equal((await client.request(path, { sessionCookie: oldCookie })).status, 401,
          'Replaying a logged-out cookie must not restore access.');
      }
      const publicSession = await (await client.request('/api/public/session')).json();
      assert.equal(publicSession.user, null);
      const adminSession = await (await client.request('/api/session')).json();
      assert.equal(adminSession.user, null);
    });
  });
}

test('switching portals in one browser rotates credentials and drops previous role access', async () => {
  await withPortalFixture(async (client) => {
    await client.login('Admin');
    const adminCookie = client.cookie, adminCsrf = client.csrf;
    assert.equal((await client.request(protectedRoutes.Admin)).status, 200);

    await client.login('Customer');
    assert.notEqual(client.cookie, adminCookie);
    assert.notEqual(client.csrf, adminCsrf);
    assert.equal((await client.request(protectedRoutes.Customer)).status, 200);
    assert.equal((await client.request(protectedRoutes.Admin)).status, 401);
    assert.equal((await client.request(protectedRoutes.Admin, { sessionCookie: adminCookie })).status, 401);
    assert.equal((await client.request('/api/logout', { method: 'POST', token: adminCsrf, body: {} })).status, 403);
    assert.equal((await client.request(protectedRoutes.Customer)).status, 200);

    const customerCookie = client.cookie;
    await client.login('Technician');
    assert.notEqual(client.cookie, customerCookie);
    assert.equal((await client.request(protectedRoutes.Technician)).status, 200);
    assert.equal((await client.request(protectedRoutes.Customer)).status, 403);
    assert.equal((await client.request(protectedRoutes.Customer, { sessionCookie: customerCookie })).status, 401);
  });
});
