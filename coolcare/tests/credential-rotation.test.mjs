import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { normalizeOrigin, validateAccounts, savePrivateManifest, rotateAccounts, apiClient, main } from '../scripts/rotate-account-passwords.mjs';

const oldPassword = 'OldTestPassword!', newPassword = 'N'.repeat(48);
const account = { email: 'presenter@example.test', currentPassword: oldPassword, expectedRole: 'Admin' };
const newManifest = () => ({ version: 1, origin: 'https://example.test', accounts: [{ email: account.email, expectedRole: account.expectedRole, newPassword, status: 'prepared' }] });

function mockApi({ uncertain = false, applyBeforeDisconnect = false } = {}) {
  let password = oldPassword, changes = 0, next = 0;
  const sessions = new Map(), logins = [];
  const response = (status, data, cookie) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...(cookie !== undefined ? { 'Set-Cookie': 'coolcare.sid=' + cookie + '; Path=/; HttpOnly' } : {}) } });
  async function request(url, options) {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Origin, 'https://example.test');
    assert.ok(url.startsWith('https://example.test/api/'));
    const id = options.headers.Cookie?.split('=')[1], session = sessions.get(id);
    const path = new URL(url).pathname;
    if (path === '/api/session') {
      const key = session ? id : String(++next);
      if (!session) sessions.set(key, { csrf: 'csrf-' + key, user: false });
      return response(200, { csrf: sessions.get(key).csrf }, key);
    }
    if (!session || session.csrf !== options.headers['X-CSRF-Token']) return response(403, {});
    const body = JSON.parse(options.body);
    if (path === '/api/public/login') {
      logins.push(body.password);
      if (body.email !== account.email || body.password !== password) return response(401, {});
      sessions.delete(id);
      const key = String(++next); sessions.set(key, { csrf: 'csrf-' + key, user: true });
      return response(200, { success: true, csrf: 'csrf-' + key, user: { id: 12, role: 'Admin', email: account.email } }, key);
    }
    if (path === '/api/public/account/password') {
      assert.equal(session.user, true);
      assert.equal(body.expectedUserId, 12);
      assert.equal(body.currentPassword, password);
      assert.equal(body.newPassword, body.confirmPassword);
      changes++;
      if (!uncertain || applyBeforeDisconnect) password = body.newPassword;
      sessions.clear();
      if (uncertain) throw new Error('Simulated connection lost');
      return response(200, { success: true, signInRequired: true }, '');
    }
    if (path === '/api/logout') { sessions.delete(id); return response(200, { success: true }, ''); }
    throw new Error('Unexpected test route');
  }
  return { request, logins, changes: () => changes };
}

test('rotation restricts destinations to explicit origins and never accepts credentials in URLs', () => {
  assert.equal(normalizeOrigin('https://example.test/'), 'https://example.test');
  assert.equal(normalizeOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeOrigin('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  for (const origin of ['http://example.test', 'http://localhost.example.test', 'https://user:secret@example.test', 'https://example.test/api', 'https://example.test/?password=secret', 'https://example.test/#fragment', 'file:///tmp/data', undefined])
    assert.throws(() => normalizeOrigin(origin));
});

test('account input checks identities and roles without including supplied secrets in errors', () => {
  assert.deepEqual(validateAccounts({ accounts: [{ ...account, email: ' PRESENTER@EXAMPLE.TEST ' }] }), [account]);
  for (const input of [{}, { accounts: [] }, { accounts: [account, account] }, { accounts: [{ ...account, expectedRole: 'Owner' }] }, { accounts: [{ email: account.email }] }]) {
    assert.throws(() => validateAccounts(input), error => !error.message.includes(oldPassword));
  }
});

test('private manifests are durable and exclusive, and omit old passwords', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coolcare-credentials-'));
  try {
    const path = join(directory, 'private', 'manifest.json'), manifest = newManifest();
    await savePrivateManifest(path, manifest, { create: true });
    assert.equal((await readFile(path, 'utf8')).includes(oldPassword), false);
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(savePrivateManifest(path, manifest, { create: true }));
    manifest.accounts[0].status = 'verified';
    await savePrivateManifest(path, manifest);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).accounts[0].status, 'verified');
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'coolcare-credentials-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('rotation handles regenerated cookies and fresh post-change sessions and verifies identity', async () => {
  const api = mockApi(), manifest = newManifest(), snapshots = [];
  await rotateAccounts({ origin: manifest.origin, accounts: [account], manifest, manifestPath: 'unused', request: api.request, save: async (_, value) => { snapshots.push(structuredClone(value)); } });
  assert.equal(api.changes(), 1);
  assert.deepEqual(api.logins, [oldPassword, newPassword]);
  assert.equal(snapshots[0].accounts[0].status, 'changing');
  assert.equal(snapshots[0].accounts[0].newPassword, newPassword);
  assert.equal(manifest.accounts[0].status, 'verified');
});

test('the default plan makes no network requests and prints no passwords', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coolcare-credentials-'));
  const originalFetch = globalThis.fetch, originalLog = console.log;
  let requests = 0; const output = [];
  try {
    const input = join(directory, 'input.json');
    await savePrivateManifest(input, { accounts: [account] }, { create: true });
    globalThis.fetch = async () => { requests++; throw new Error('No request is expected'); };
    console.log = value => output.push(value);
    await main(['--origin=https://example.test', '--input=' + input]);
    assert.equal(requests, 0);
    assert.equal(output.join('\n').includes(oldPassword), false);
    assert.equal(JSON.parse(output[0]).mode, 'plan');
  } finally {
    globalThis.fetch = originalFetch; console.log = originalLog;
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + 'coolcare-credentials-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('a private manifest write failure prevents the password request', async () => {
  const api = mockApi(), manifest = newManifest();
  await assert.rejects(rotateAccounts({ origin: manifest.origin, accounts: [account], manifest, manifestPath: 'unused', request: api.request, save: async () => { throw new Error('Disk unavailable'); } }));
  assert.equal(api.changes(), 0);
});

test('lost response after a committed change is reconciled by new login without another password change', async () => {
  const api = mockApi({ uncertain: true, applyBeforeDisconnect: true }), manifest = newManifest();
  const input = { origin: manifest.origin, accounts: [account], manifest, manifestPath: 'unused', request: api.request, save: async () => {} };
  await rotateAccounts(input);
  assert.equal(manifest.accounts[0].status, 'uncertain');
  await rotateAccounts({ ...input, resuming: true });
  assert.equal(manifest.accounts[0].status, 'verified');
  assert.equal(api.changes(), 1);
  assert.deepEqual(api.logins, [oldPassword, newPassword]);
});

test('an unresolved uncertain password change never retries the old password mutation', async () => {
  const api = mockApi({ uncertain: true }), manifest = newManifest();
  const input = { origin: manifest.origin, accounts: [account], manifest, manifestPath: 'unused', request: api.request, save: async () => {} };
  await rotateAccounts(input);
  await rotateAccounts({ ...input, resuming: true });
  assert.equal(manifest.accounts[0].status, 'uncertain');
  assert.equal(api.changes(), 1);
  assert.deepEqual(api.logins, [oldPassword, newPassword]);
});

test('native fetch rejects redirects before credentials can reach the redirected destination', async () => {
  let leakedRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/api/session') { res.writeHead(302, { Location: '/other-service' }); res.end(); }
    else { leakedRequests++; res.writeHead(200); res.end('{}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const client = apiClient('http://127.0.0.1:' + server.address().port);
    await assert.rejects(client.login(account.email, oldPassword, 'Admin'));
    assert.equal(leakedRequests, 0);
  } finally { server.close(); await once(server, 'close'); }
});
