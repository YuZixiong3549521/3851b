import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../components/public-site/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { loginErrorMessage } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

test('login preserves actual API errors instead of reporting every rejection as a wrong password', () => {
  for (const [status, error] of [
    [401, 'Incorrect email or password.'],
    [403, 'Untrusted request origin.'],
    [403, 'Session expired. Refresh the page and sign in again.'],
    [503, 'Database request failed. Check that MySQL is running, then retry.'],
  ]) assert.equal(loginErrorMessage(status, { error }), error);
  assert.equal(loginErrorMessage(400, { message: 'Please enter a valid email.' }), 'Please enter a valid email.');
});

test('empty, malformed and non-JSON error responses use status-specific messages', () => {
  for (const body of [null, '', {}, { error: {} }, { error: ' ', message: false }]) {
    assert.match(loginErrorMessage(401, body), /Invalid email or password/);
    assert.match(loginErrorMessage(403, body), /blocked/);
    assert.match(loginErrorMessage(429, body), /Too many sign-in attempts/);
    assert.match(loginErrorMessage(503, body), /service is unavailable/);
    assert.match(loginErrorMessage(200, body), /Unable to sign in/);
  }
});
