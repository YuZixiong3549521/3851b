import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { openPrivilegedFixtureConnection } from './privileged-fixture.mjs';

const oldPassword = 'Isolated-password-before-2026!';
const newPassword = 'Isolated-password-after-2026!';
const routes = { Customer: '/api/customer/bookings', Technician: '/api/technician/jobs', Admin: '/api/overview' };

async function fixture(work) {
  if (!['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST)) throw new Error('Password integration fixtures require the local database.');
  const connection = await openPrivilegedFixtureConnection();
  let server;
  try {
    await connection.beginTransaction();
    const initialHash = await bcrypt.hash(oldPassword, 4);
    const accounts = {};
    for (const role of Object.keys(routes)) {
      const [[r]] = await connection.execute('SELECT role_id FROM role WHERE role_name=?', [role]);
      const email = `password-${role.toLowerCase()}-${randomUUID()}@example.test`;
      const [u] = await connection.execute("INSERT INTO user_account(role_id,full_name,email,password_hash,status) VALUES (?,?,?,?,'Active')", [r.role_id, `Password ${role} fixture`, email, initialHash]);
      const table = { Customer: 'customer', Technician: 'technician', Admin: 'admin_profile' }[role];
      await connection.execute(`INSERT INTO ${table}(user_id) VALUES (?)`, [u.insertId]);
      accounts[role] = { id: u.insertId, email, password: oldPassword };
    }
    const handle = { execute: connection.execute.bind(connection), query: connection.query.bind(connection),
      beginTransaction: () => connection.query('SAVEPOINT password_change'), commit: () => connection.query('RELEASE SAVEPOINT password_change'),
      rollback: () => connection.query('ROLLBACK TO SAVEPOINT password_change'), release() {} };
    const db = { ...handle, getConnection: async () => handle };
    server = createApp({ pool: db, secret: process.env.SESSION_SECRET }).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const client = () => {
      let cookie = '', csrf = '';
      return {
        get cookie() { return cookie; }, get csrf() { return csrf; },
        async request(path, { method = 'GET', body, token = csrf, sessionCookie = cookie } = {}) {
          const headers = { Cookie: sessionCookie, 'Content-Type': 'application/json' };
          if (token !== null) headers['X-CSRF-Token'] = token;
          const result = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
          if (result.headers.get('set-cookie')) cookie = result.headers.get('set-cookie').split(';')[0];
          return result;
        },
        async login(account, legacy = false) {
          const session = await this.request('/api/session'); assert.equal(session.status, 200);
          csrf = (await session.json()).csrf;
          const response = await this.request(legacy ? '/api/login' : '/api/public/login', { method: 'POST', body: { email: account.email, password: account.password } });
          const json = await response.json(); if (response.ok) csrf = json.csrf;
          return { response, json };
        },
        async guest() { const r = await this.request('/api/session'); csrf = (await r.json()).csrf; },
      };
    };
    await work({ connection, accounts, client, initialHash });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    try { await connection.rollback(); } finally { await connection.end(); }
  }
}

for (const role of Object.keys(routes)) {
  test(`${role}: self-service password rotation verifies identity and revokes every old session only for that user`, () => fixture(async ({ connection, accounts, client }) => {
    const first = client(), second = client(), other = client(), guest = client();
    await guest.guest();
    const body = { currentPassword: oldPassword, newPassword, confirmPassword: newPassword, expectedUserId: accounts[role].id };
    assert.equal((await guest.request('/api/public/account/password', { method: 'POST', body })).status, 401);
    assert.equal((await first.login(accounts[role])).response.status, 200);
    assert.equal((await second.login(accounts[role], role === 'Admin')).response.status, 200);
    const otherRole = role === 'Customer' ? 'Technician' : 'Customer';
    assert.equal((await other.login(accounts[otherRole])).response.status, 200);
    const originalFirstCookie = first.cookie, originalSecondCookie = second.cookie;
    assert.equal((await first.request('/api/public/account/password', { method: 'POST', body, token: null })).status, 403);
    assert.equal((await first.request('/api/public/account/password', { method: 'POST', body: { ...body, currentPassword: 'incorrect' } })).status, 400);
    assert.equal((await first.request('/api/public/account/password', { method: 'POST', body: { ...body, expectedUserId: accounts[otherRole].id } })).status, 409);
    assert.equal((await first.request('/api/public/account/password', { method: 'POST', body: { ...body, userId: accounts[otherRole].id } })).status, 400);
    assert.equal((await first.request('/api/public/account/password', { method: 'POST', body: { ...body, newPassword: 'short', confirmPassword: 'short' } })).status, 400);
    assert.equal((await second.request(routes[role])).status, 200, 'failed changes retain signed-in sessions');
    const changed = await first.request('/api/public/account/password', { method: 'POST', body });
    assert.equal(changed.status, 200, JSON.stringify(await changed.clone().json()));
    assert.equal((await changed.json()).signInRequired, true);
    assert.match(changed.headers.get('set-cookie'), /^coolcare\.sid=;/);
    for (const cookie of [originalFirstCookie, originalSecondCookie]) assert.equal((await second.request(routes[role], { sessionCookie: cookie })).status, 401, 'old cookies must not restore access');
    assert.equal((await other.request(routes[otherRole])).status, 200, 'another account is not logged out');
    const oldLogin = client(); assert.equal((await oldLogin.login(accounts[role])).response.status, 401);
    const next = client(); const signedIn = await next.login({ ...accounts[role], password: newPassword });
    assert.equal(signedIn.response.status, 200); assert.equal(signedIn.json.user.id, accounts[role].id);
    assert.equal((await next.request(routes[role])).status, 200);
    const [[stored]] = await connection.execute('SELECT password_hash FROM user_account WHERE user_id=?', [accounts[role].id]);
    assert.ok(await bcrypt.compare(newPassword, stored.password_hash));
    assert.equal(JSON.stringify(signedIn.json).includes('credentialFingerprint'), false);
  }));
}

test('the legacy technician password endpoint also revokes other sessions', () => fixture(async ({ accounts, client }) => {
  const a = client(), b = client();
  await a.login(accounts.Technician); await b.login(accounts.Technician);
  const r = await a.request('/api/technician/password', { method: 'POST', body: { currentPassword: oldPassword, newPassword, confirmPassword: newPassword } });
  assert.equal(r.status, 200);
  assert.equal((await b.request(routes.Technician)).status, 401);
}));

test('credential fingerprints invalidate sessions after an out-of-band password rotation', () => fixture(async ({ connection, accounts, client }) => {
  const account = client(); await account.login(accounts.Admin, true);
  await connection.execute('UPDATE user_account SET password_hash=? WHERE user_id=?', [await bcrypt.hash(newPassword, 4), accounts.Admin.id]);
  assert.equal((await account.request('/api/overview')).status, 401, 'a stale session cannot bypass the changed password');
  const session = await (await account.request('/api/public/session')).json(); assert.equal(session.user, null);
}));
