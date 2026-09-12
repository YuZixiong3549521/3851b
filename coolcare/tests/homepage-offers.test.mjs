import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/homepage-offers.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { readHomepageOffers, homepageOfferTotal, bookingForHomepageIssue, homepageIssues } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

test('homepage estimates use catalogue rates for every selected unit and all four annual visits', () => {
  const offers = readHomepageOffers({ currency: 'SGD', offers: [
    { name: 'Cleaning', base: '50.00', perUnit: '25.00' },
    { name: 'Repair', base: 50, perUnit: 0 },
    { name: 'Annual Cleaning Bundle', base: 180, perUnit: 80, includedVisits: 4 },
  ] });
  assert.equal(homepageOfferTotal(offers[0], 1), 50);
  assert.equal(homepageOfferTotal(offers[0], 3), 100);
  assert.equal(homepageOfferTotal(offers[1], 3), 50);
  assert.equal(homepageOfferTotal(offers[2], 2), 260);
  assert.equal(homepageOfferTotal(offers[2], 2) / offers[2].includedVisits, 65);
  assert.equal(homepageOfferTotal({ name: 'Cleaning', base: 0.1, perUnit: 0.2 }, 2), 0.3);
});

test('missing, malformed or incompatible public prices do not produce made-up estimates', () => {
  for (const value of [null, {}, { currency: 'USD', offers: [{ name: 'Cleaning', base: 50, perUnit: 25 }] }, { currency: 'SGD', offers: null }]) assert.deepEqual(readHomepageOffers(value), []);
  const values = [undefined, null, '', ' ', -1, Infinity, 'not a price'];
  for (const value of values) assert.deepEqual(readHomepageOffers({ currency: 'SGD', offers: [{ name: 'Cleaning', base: value, perUnit: 25 }] }), []);
  assert.deepEqual(readHomepageOffers({ currency: 'SGD', offers: [{ name: 'Annual Cleaning Bundle', base: 180, perUnit: 80, includedVisits: 3 }] }), []);
  assert.equal(homepageOfferTotal(undefined, 2), null);
  for (const units of [0, 1.5, 11, NaN]) assert.equal(homepageOfferTotal({ name: 'Cleaning', base: 50, perUnit: 25 }, units), null);
});

test('Needs Cleaning opens Cleaning and each issue carries its own symptom into booking', () => {
  const cleaning = bookingForHomepageIssue('needs-cleaning');
  assert.equal(cleaning.serviceName, 'Cleaning');
  assert.match(cleaning.symptoms, /^Needs Cleaning: Dust or dirt/);
  for (const issue of homepageIssues.filter(item => item.id !== 'needs-cleaning')) {
    const booking = bookingForHomepageIssue(issue.id);
    assert.equal(booking.serviceName, 'Repair');
    assert.ok(booking.symptoms.startsWith(issue.name + ': '));
  }
  assert.equal(bookingForHomepageIssue(null), null);
  assert.equal(bookingForHomepageIssue('Needs Cleaning'), null, 'selection uses stable IDs, not display names');
});
