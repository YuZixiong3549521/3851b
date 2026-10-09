import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';
import { createApp } from '../server/app.mjs';

async function withServer(origin, run) {
  const server = createApp({
    pool: {},
    secret: 'origin-regression-test-secret-at-least-32-characters',
    origin,
  }).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function session(base) {
  const response = await fetch(base + '/api/session');
  assert.equal(response.status, 200);
  const { csrf } = await response.json();
  return {
    Cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '),
    'X-CSRF-Token': csrf,
  };
}

for (const configuredOrigin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
  test(`${configuredOrigin}: local aliases permit a real session mutation and still require CSRF`, async () => {
    await withServer(configuredOrigin, async base => {
      for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
        const headers = { ...await session(base), Origin: origin };
        const rejected = await fetch(base + '/api/public/logout', {
          method: 'POST', headers: { ...headers, 'X-CSRF-Token': 'wrong-token' },
        });
        assert.equal(rejected.status, 403);
        assert.match((await rejected.json()).error, /Session expired/);
        const accepted = await fetch(base + '/api/public/logout', { method: 'POST', headers });
        assert.equal(accepted.status, 200, origin);
        assert.equal((await accepted.json()).success, true);
        const replay = await fetch(base + '/api/public/logout', { method: 'POST', headers });
        assert.equal(replay.status, 403, 'Destroyed session cookies cannot be replayed.');
      }
    });
  });
}

test('origin aliases never accept another port, protocol, remote site, spoofed host or opaque origin', async () => {
  await withServer('http://127.0.0.1:3000', async base => {
    const headers = await session(base);
    for (const origin of [
      'http://localhost:3001', 'http://localhost', 'http://127.0.0.1:4000',
      'https://localhost:3000', 'http://localhost.example.test:3000',
      'http://127.0.0.1.example.test:3000', 'http://192.168.1.2:3000',
      'https://example.test', 'null', 'http://localhost:3000/',
    ]) {
      const response = await fetch(base + '/api/public/logout', {
        method: 'POST', headers: { ...headers, Origin: origin, 'X-Forwarded-Host': 'localhost:3000' },
      });
      assert.equal(response.status, 403, origin);
      assert.equal((await response.json()).error, 'Untrusted request origin.');
    }
    // fetch overwrites Host; use HTTP directly to exercise a forged Host header.
    const response = await new Promise((resolve, reject) => {
      get(base + '/api/session', { headers: { Host: 'example.test' } }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body }));
        response.on('error', reject);
      }).on('error', reject);
    });
    assert.equal(response.status, 403);
    assert.equal(JSON.parse(response.body).error, 'Only localhost is allowed.');
    const missingCsrf = await fetch(base + '/api/public/logout', {
      method: 'POST', headers: { Cookie: headers.Cookie, Origin: 'http://localhost:3000' },
    });
    assert.equal(missingCsrf.status, 403);
    assert.match((await missingCsrf.json()).error, /Session expired/);
  });
});

test('a non-local configured origin remains exact and does not gain local aliases', async () => {
  await withServer('https://coolcare.example.test', async base => {
    const headers = await session(base);
    for (const origin of ['http://localhost:3000', 'https://localhost', 'https://other.example.test']) {
      const response = await fetch(base + '/api/public/logout', {
        method: 'POST', headers: { ...headers, Origin: origin },
      });
      assert.equal(response.status, 403);
    }
    const accepted = await fetch(base + '/api/public/logout', {
      method: 'POST', headers: { ...headers, Origin: 'https://coolcare.example.test' },
    });
    assert.equal(accepted.status, 200);
  });
});
