import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/customer-booking-form.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const compiledModule = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const { bookingServiceChanged, createDefaultCustomerBookingForm } = compiledModule;

void test('default booking form uses the account default address and resets every downstream answer', () => {
  const form = createDefaultCustomerBookingForm([
    { addressLine: 'First address', postalCode: '111111', isDefault: false },
    { addressLine: 'Default address', postalCode: '222222', isDefault: true },
  ], '2026-10-23');

  assert.deepEqual(form, {
    serviceAddress: 'Default address',
    postalCode: '222222',
    specialNotes: '',
    numberOfUnits: 1,
    preferredDate: '2026-10-23',
    timeSlot: '',
    problemDescription: '',
  });
});

void test('default booking form falls back to the first address or a blank address', () => {
  assert.equal(createDefaultCustomerBookingForm([
    { addressLine: 'First address', postalCode: null, isDefault: false },
  ], '2026-10-23').serviceAddress, 'First address');
  assert.deepEqual(createDefaultCustomerBookingForm([], '2026-10-23'), {
    serviceAddress: '',
    postalCode: '',
    specialNotes: '',
    numberOfUnits: 1,
    preferredDate: '2026-10-23',
    timeSlot: '',
    problemDescription: '',
  });
});

void test('service identity changes reset the form but property type and service order do not', () => {
  const cleaning = { mode: 'custom', serviceIds: [1] };
  const repair = { mode: 'custom', serviceIds: [2] };
  const combined = { mode: 'custom', serviceIds: [1, 2] };
  const reordered = { mode: 'custom', serviceIds: [2, 1] };
  const annual = { mode: 'bundle', packageId: 10, propertyType: 'hdb-4', serviceIds: [1] };
  const annualOtherProperty = { ...annual, propertyType: 'condo' };

  assert.equal(bookingServiceChanged(cleaning, repair), true);
  assert.equal(bookingServiceChanged(cleaning, combined), true);
  assert.equal(bookingServiceChanged(combined, reordered), false);
  assert.equal(bookingServiceChanged(combined, annual), true);
  assert.equal(bookingServiceChanged(annual, annualOtherProperty), false);
  assert.equal(bookingServiceChanged(annual, { ...annual, packageId: 11 }), true);
});
