// Run after npm run build. Uses deliberately unreachable MySQL, never business data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path,
      headers: { host: 'coolcare-ci.invalid' }, timeout: 10000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('error', reject);
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Smoke request timed out.')));
    req.end();
  });
}
test('built production app serves both portals/assets and same-origin API without .env.local', { timeout: 90000 }, async t => {
  const [port, apiPort, webPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const child = spawn(process.execPath, ['scripts/start-production.mjs'], {
    cwd: resolve(import.meta.dirname, '..'), windowsHide: true,
    env: { ...process.env, PORT: String(port), API_PORT: String(apiPort), WEB_PORT: String(webPort),
      WEB_ORIGIN: 'https://coolcare-ci.invalid', NODE_ENV: 'production', MAIL_MODE: 'disabled',
      DB_HOST: '127.0.0.1', DB_PORT: '1', DB_USER: 'smoke', DB_PASSWORD: 'smoke-only',
      DB_NAME: 'smoke', DB_SSL: 'false', SESSION_SECRET: 'smoke-test-secret-at-least-32-characters' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; if (process.env.DEBUG_SMOKE) process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { log += chunk; if (process.env.DEBUG_SMOKE) process.stderr.write(chunk); });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    // IPC delivers graceful shutdown on Windows as well as Linux.
    if (child.connected) child.send('shutdown');
    else child.kill('SIGTERM');
    await exited;
  });
  let ready = false;
  const deadline = Date.now() + 45000;
  for (let attempt = 0; Date.now() < deadline && !t.signal.aborted; attempt++) {
    if (child.exitCode !== null) throw new Error(`Production process exited: ${log}`);
    try {
      const response = await get(port, '/');
      if (process.env.DEBUG_SMOKE) console.log(`Smoke readiness status: ${response.status}`);
      if (response.status === 200) { ready = true; break; }
    } catch (error) { if (process.env.DEBUG_SMOKE) console.log(`Smoke readiness: ${error.message}`); }
    await new Promise(done => setTimeout(done, 300));
  }
  assert.ok(ready, `Production frontend did not become ready: ${log}`);
  for (const path of ['/', '/customer', '/admin/orders', '/technician/index.html']) {
    if (process.env.DEBUG_SMOKE) console.log(`Smoke checking ${path}`);
    const response = await get(port, path);
    assert.equal(response.status, 200, `${path}: ${response.body.slice(0, 300)}`);
    assert.match(response.headers['content-type'], /text\/html/);
    if (path === '/technician/index.html') {
      const asset = response.body.match(/src="([^"]+\.js)"/);
      assert.ok(asset, 'Technician entry must reference its built JS asset.');
      assert.equal((await get(port, asset[1])).status, 200);
    }
  }
  const session = await get(port, '/api/session');
  assert.equal(session.status, 200);
  assert.ok(JSON.parse(session.body).csrf);
  assert.match(session.headers['set-cookie'][0], /Secure/);
  assert.equal((await get(port, '/api/health')).status, 503, 'Unreachable database must not report ready.');
  assert.doesNotMatch(log, /Run npm run setup first/);
  if (process.env.DEBUG_SMOKE) console.log('Smoke requests passed; stopping child processes.');
});
