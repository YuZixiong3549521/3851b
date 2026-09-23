import test from 'node:test';
import assert from 'node:assert/strict';
import { getLoginHref, getPostLoginHref, getSafeReturnTo, signOutSession } from '../lib/portal-session.mjs';

test('login returns to existing owned portal routes and retains assistant and booking entry points', () => {
  for (const [role, path] of [
    ['Customer', '/customer/bookings/276'], ['Customer', '/customer/history/12'],
    ['Customer', '/customer?assistant=resume'], ['Admin', '/admin/dispatch?date=2026-09-28'],
    ['Admin', '/admin/inventory/parts/3/edit'], ['Technician', '/technician/index.html#reports'],
  ]) {
    const href = getLoginHref(path);
    const returnTo = new URLSearchParams(href.split('?')[1]).get('returnTo');
    assert.equal(getPostLoginHref(role, returnTo), path);
  }
  assert.equal(getPostLoginHref('Customer', 'assistant'), '/customer?assistant=resume');
  assert.equal(getPostLoginHref('Customer', 'bookings'), '/customer/bookings');
});

test('redirect destinations reject external URLs, API routes, disguised paths and another role', () => {
  for (const path of ['https://example.com', '//example.com', '/\\example.com', 'javascript:alert(1)', '/api/logout', '/customer%2f..%2fadmin', '/admin/orders', '/technician/index.html', '/customer\n']) {
    assert.equal(getSafeReturnTo(path, 'Customer'), null, path);
    assert.equal(getPostLoginHref('Customer', path), '/customer');
  }
  assert.equal(getPostLoginHref('Technician', '/customer/bookings/1'), '/technician/index.html');
  assert.equal(getPostLoginHref('Admin', 'assistant'), '/admin/orders');
  assert.equal(getPostLoginHref('__proto__', '/customer'), '/');
  assert.equal(getLoginHref('https://example.com'), '/#/login');
});

test('logout reads a fresh CSRF token, coalesces duplicate clicks and redirects only after success', async t => {
  const calls = [], destinations = [], events = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push([path, options]);
    return Response.json(path === '/api/session' ? { csrf: 'current-token' } : { ok: true });
  });
  const originalWindow = globalThis.window;
  globalThis.window = { dispatchEvent: event => events.push(event.type), location: { replace: href => destinations.push(href) } };
  t.after(() => { if (originalWindow) globalThis.window = originalWindow; else delete globalThis.window; });
  await Promise.all([signOutSession(), signOutSession()]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].cache, 'no-store');
  assert.equal(calls[1][0], '/api/logout');
  assert.equal(calls[1][1].headers['X-CSRF-Token'], 'current-token');
  assert.deepEqual(destinations, ['/#/login']);
  assert.deepEqual(events, ['coolcare:signed-out']);
});

test('failed logout keeps the page and can be retried without pretending the session ended', async t => {
  const destinations = [], events = [];
  let failed = true;
  t.mock.method(globalThis, 'fetch', async path => path === '/api/session' ? Response.json({ csrf: 'fresh-token' }) : Response.json({}, { status: failed ? 503 : 200 }));
  const originalWindow = globalThis.window;
  globalThis.window = { dispatchEvent: event => events.push(event.type), location: { replace: href => destinations.push(href) } };
  t.after(() => { if (originalWindow) globalThis.window = originalWindow; else delete globalThis.window; });
  await assert.rejects(signOutSession(), /Unable to sign out/);
  assert.deepEqual(destinations, []);
  assert.deepEqual(events, []);
  failed = false;
  await signOutSession();
  assert.deepEqual(destinations, ['/#/login']);
});
