import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhoneNumber, phoneNumberError } from '../lib/phone-number.mjs';

test('contact numbers normalize Singapore mobile, fixed and IP phones plus international formats', () => {
  for (const value of ['9123 4567', '+65 9123-4567', '  +65 (9123) 4567  ']) assert.equal(normalizePhoneNumber(value), '+6591234567');
  for (const prefix of ['3','6','8','9']) assert.equal(normalizePhoneNumber(prefix + '1234567'), '+65' + prefix + '1234567');
  assert.equal(normalizePhoneNumber('+61 412 345 678'), '+61412345678');
  assert.equal(normalizePhoneNumber('+1 (202) 555-0123'), '+12025550123');
  assert.equal(phoneNumberError('91234567'), '');
});

test('contact validation rejects letters, local short codes, malformed Singapore and international numbers', () => {
  for (const value of [null, 91234567, '', ' ', 'test', '911', '12345678', '+659123456', '+65912345678', '++6591234567', '+01 23456789', '+1 234', '+1234567890123456', '91234567 ext 2']) {
    assert.equal(normalizePhoneNumber(value), null, String(value));
    assert.ok(phoneNumberError(value), String(value));
  }
});
