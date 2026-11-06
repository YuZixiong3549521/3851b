import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/assistant-guidance.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { assistantIssueSelection, checkedSlotAvailability } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const options = { services: [{ serviceId: 10, code: 'cleaning', name: 'Cleaning' }, { serviceId: 20, code: 'repair', name: 'Repair' }], bundles: [{ packageId: 30, code: 'annual-cleaning', name: 'Annual Cleaning Bundle' }] };
const draft = { notes: 'Please call on arrival.', serviceIds: [10, 20], numberOfUnits: 2 };

test('symptoms preserve combined services and notes without duplicating the same choice', () => {
  const result = assistantIssueSelection(draft, options, 'repair', 'Water leaking');
  assert.equal(result.replacesSelection, false);
  assert.deepEqual(result.patch.serviceIds, [10, 20]);
  assert.equal(result.patch.notes, 'Please call on arrival.\nWater leaking');
  assert.deepEqual(assistantIssueSelection({ ...draft, ...result.patch }, options, 'repair', 'Water leaking').patch, result.patch);
  assert.deepEqual(assistantIssueSelection({ ...draft, serviceIds: undefined, serviceId: 10 }, options, 'repair').patch.serviceIds, [10, 20]);
});

test('annual cleaning symptoms keep the chosen property while switching booking types needs explicit replacement', () => {
  const annual = { ...draft, serviceIds: [], packageId: 30, propertyType: 'hdb-4' };
  const cleaning = assistantIssueSelection(annual, options, 'cleaning', 'Needs cleaning');
  assert.equal(cleaning.replacesSelection, false);
  assert.equal({ ...annual, ...cleaning.patch }.propertyType, 'hdb-4');
  assert.equal({ ...annual, ...cleaning.patch }.packageId, 30);
  const repair = assistantIssueSelection(annual, options, 'repair', 'Not cooling');
  assert.equal(repair.replacesSelection, true);
  assert.equal(repair.patch.packageId, undefined);
  assert.deepEqual(repair.patch.serviceIds, [20]);
  const bundle = assistantIssueSelection(draft, options, 'annual-cleaning');
  assert.equal(bundle.replacesSelection, true);
  assert.equal(bundle.patch.packageId, 30);
  assert.equal(bundle.patch.notes, draft.notes);
  assert.throws(() => assistantIssueSelection({ ...draft, notes: 'x'.repeat(1000) }, options, 'repair', 'Leak'), /1,000 characters/);
});

const codes = ['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00'];
const day = (date, full = '') => ({ date, slots: codes.map(code => ({ code, available: code !== full })) });
test('annual service times are checked across every visit and incomplete responses cannot appear available', () => {
  const dates = ['2027-01-04', '2027-04-05', '2027-07-05', '2027-10-04'];
  const result = { dates: dates.map(date => day(date)) };
  result.dates[2] = day(dates[2], codes[1]);
  const available = checkedSlotAvailability(dates, result);
  assert.equal(available.get(codes[0]), true);
  assert.equal(available.get(codes[1]), false);
  assert.throws(() => checkedSlotAvailability(dates, { dates: result.dates.slice(1) }), /dates could not be checked/);
  const missingSlot = structuredClone(result);
  missingSlot.dates[3].slots.pop();
  assert.throws(() => checkedSlotAvailability(dates, missingSlot), /times could not be checked/);
  assert.throws(() => checkedSlotAvailability(dates, { dates: [...result.dates, result.dates[0]] }), /dates could not be checked/);
});
