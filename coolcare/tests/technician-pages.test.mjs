import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reportFormSchema,
  profileSchema,
  passwordSchema,
} from '../server/technician-pages.mjs';
test('report schema validates required work, checklist and safe signature links', () => {
  const r = {
    workPerformed: 'Cleaned filters',
    checklist: 'All checks passed',
  };
  assert.ok(reportFormSchema.safeParse(r).success);
  assert.equal(
    reportFormSchema.safeParse({ ...r, workPerformed: ' ' }).success,
    false,
  );
  assert.equal(
    reportFormSchema.safeParse({
      ...r,
      customerSignatureUrl: 'javascript:alert(1)',
    }).success,
    false,
  );
  assert.equal(
    reportFormSchema.safeParse({
      ...r,
      technicianSignatureUrl: 'https://example.test/signature.png',
    }).success,
    true,
  );
});
test('profile rejects roles/status changes and invalid availability', () => {
  const p = {
    expectedVersion: 'a'.repeat(64),
    fullName: 'Chris',
    phone: '91234567',
    primaryRegion: 'North',
    availability: 'Available',
  };
  assert.ok(profileSchema.safeParse(p).success);
  assert.equal(
    profileSchema.safeParse({ ...p, status: 'Active' }).success,
    false,
  );
  assert.equal(
    profileSchema.safeParse({ ...p, availability: 'Anything' }).success,
    false,
  );
});
test('password confirmation and bcrypt byte limit enforced', () => {
  assert.equal(
    passwordSchema.safeParse({
      currentPassword: 'OldPassword!',
      newPassword: 'NewPassword!',
      confirmPassword: 'WrongPassword!',
    }).success,
    false,
  );
  assert.equal(
    passwordSchema.safeParse({
      currentPassword: 'OldPassword!',
      newPassword: '密'.repeat(30),
      confirmPassword: '密'.repeat(30),
    }).success,
    false,
  );
});
