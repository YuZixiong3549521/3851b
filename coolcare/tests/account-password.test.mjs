import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialFingerprint, verifySessionCredential, passwordSchema } from '../server/account-password.mjs';

test('password changes reject unsupported fields, repeated passwords and bcrypt truncation', () => {
  const good = { currentPassword: 'Previous-password', newPassword: 'Next-password', confirmPassword: 'Next-password' };
  assert.equal(passwordSchema.safeParse(good).success, true);
  assert.equal(passwordSchema.safeParse({ ...good, userId: 99 }).success, false);
  assert.equal(passwordSchema.safeParse({ ...good, newPassword: good.currentPassword, confirmPassword: good.currentPassword }).success, false);
  assert.equal(passwordSchema.safeParse({ ...good, newPassword: '密'.repeat(25), confirmPassword: '密'.repeat(25) }).success, false);
});

test('a concurrently restored old credential session becomes a guest; unrelated sessions remain valid', async () => {
  const req = { session: { portalUser: { id: 7 }, credentialFingerprint: credentialFingerprint('old-hash') } };
  let reset = false, proceeded = false;
  req.session.regenerate = callback => { reset = true; req.session = {}; callback(); };
  await verifySessionCredential({ execute: async () => [[{ password_hash: 'new-hash' }]] })(req, {}, () => { proceeded = true; });
  assert.equal(reset, true); assert.equal(proceeded, true); assert.equal(req.session.portalUser, undefined);
  const valid = { session: { portalUser: { id: 8 }, credentialFingerprint: credentialFingerprint('current-hash'), regenerate: () => { throw new Error('Must not reset a current session'); } } };
  await verifySessionCredential({ execute: async () => [[{ password_hash: 'current-hash' }]] })(valid, {}, () => {});
  assert.equal(valid.session.portalUser.id, 8);
});
