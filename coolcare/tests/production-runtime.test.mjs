import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { productionConfig } from '../server/production-config.mjs';
import { createProductionGateway } from '../server/production-gateway.mjs';
import { createApp } from '../server/app.mjs';

const origin = 'https://coolcare.example';
const env = { DB_HOST: 'db.example', DB_USER: 'app', DB_PASSWORD: 'test-only', DB_NAME: 'coolcare',
  SESSION_SECRET: 'test-only-secret-that-is-at-least-32-characters', WEBSITE_HOSTNAME: 'coolcare.example' };
test('production configuration uses App Service environment and rejects unsafe/missing settings', () => {
  assert.equal(productionConfig(env).origin, origin);
  assert.equal(productionConfig({ ...env, PORT: '9000' }).port, 9000);
  assert.throws(() => productionConfig({ ...env, DB_PASSWORD: '' }), /DB_PASSWORD/);
  assert.throws(() => productionConfig({ ...env, WEB_ORIGIN: 'http://coolcare.example' }), /HTTPS/);
  assert.throws(() => productionConfig({ ...env, WEB_ORIGIN: `${origin}/customer` }), /without a path/);
  assert.throws(() => productionConfig({ ...env, PORT: '3001' }), /different/);
});

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
function get(port, path, headers = {}, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method,
      headers: { host: 'coolcare.example', ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
test('one public listener routes portals/API, preserves secure sessions and enforces origin/CSRF', async t => {
  const pool = { query: async () => [[]] };
  const api = createServer(createApp({ pool, secret: env.SESSION_SECRET, origin, production: true }));
  const web = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(JSON.stringify({ path: req.url, host: req.headers.host, proto: req.headers['x-forwarded-proto'] }));
  });
  const apiPort = await listen(api);
  const webPort = await listen(web);
  const gateway = createProductionGateway({ origin, apiPort, webPort });
  const port = await listen(gateway);
  t.after(() => { for (const server of [gateway, web, api]) { server.closeAllConnections(); server.close(); } });
  for (const path of ['/', '/customer/bookings', '/admin/orders', '/technician/index.html', '/_next/static/example.js']) {
    const response = await get(port, path, { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http' });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.text), { path, host: 'coolcare.example', proto: 'https' });
  }
  const session = await get(port, '/api/session');
  assert.equal(session.status, 200);
  const csrf = JSON.parse(session.text).csrf;
  const cookie = session.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  const headers = { cookie: cookie.split(';')[0], origin, 'content-type': 'application/json' };
  assert.equal((await get(port, '/api/session', { cookie: headers.cookie })).text, session.text);
  assert.equal((await get(port, '/api/not-a-route', headers, 'POST', '{}')).status, 403);
  // Valid CSRF advances to the existing authentication guard; it does not bypass it.
  assert.equal((await get(port, '/api/not-a-route', { ...headers, 'x-csrf-token': csrf }, 'POST', '{}')).status, 401);
  assert.equal((await get(port, '/api/session', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await get(port, '/', { host: 'evil.example' })).status, 403);
  assert.equal((await get(port, '/api/health')).status, 200);
});

test('gateway returns a bounded 503 when a backend is unavailable', async t => {
  const unused = createServer();
  const portUnused = await listen(unused);
  await new Promise(resolve => unused.close(resolve));
  const gateway = createProductionGateway({ origin, apiPort: portUnused, webPort: portUnused });
  const port = await listen(gateway);
  t.after(() => { gateway.closeAllConnections(); gateway.close(); });
  assert.equal((await get(port, '/')).status, 503);
});
