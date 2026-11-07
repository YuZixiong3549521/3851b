import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/assistant-faq.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { assistantQuestions, answerAssistantQuestion } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const catalogue = {
  services: [
    { serviceId: 1, name: 'Cleaning', code: 'cleaning', basePrice: 47, additionalUnitPrice: 29 },
    { serviceId: 2, name: 'Repair', code: 'repair', basePrice: 63, additionalUnitPrice: 0 },
  ],
  bundles: [{ packageId: 3, name: 'Annual Cleaning Bundle', code: 'annual-cleaning', propertyPrices: [{ price: 390 }, { price: 270 }] }],
};
const answer = id => answerAssistantQuestion(id, catalogue).paragraphs.join(' ');

test('FAQ prices use catalogue values and distinguish first-unit, extra-unit and diagnostic fees', () => {
  const result = answer('prices');
  assert.match(result, /47\.00 for the first unit/);
  assert.match(result, /29\.00 for each additional unit/);
  assert.match(result, /63\.00 minimum diagnostic fee/);
  assert.match(result, /270\.00 for four quarterly visits/);
  assert.doesNotMatch(result, /50\.00/);
  const equal = structuredClone(catalogue);
  equal.services[0].additionalUnitPrice = 47;
  assert.match(answerAssistantQuestion('prices', equal).paragraphs.join(' '), /47\.00 per unit, per visit/);
  assert.match(result, /No online payment is collected/);
});

test('FAQ missing prices are explicit and previous answers stay unchanged after the catalogue changes', () => {
  const noPrices = answerAssistantQuestion('prices', null).paragraphs.join(' ');
  assert.match(noPrices, /have not loaded/);
  assert.doesNotMatch(noPrices, /SGD|\$\d/);
  const current = structuredClone(catalogue);
  const savedAnswer = answerAssistantQuestion('prices', current);
  current.services[0].basePrice = 91;
  assert.match(savedAnswer.paragraphs.join(' '), /47\.00/);
  assert.doesNotMatch(savedAnswer.paragraphs.join(' '), /91\.00/);
  assert.match(answerAssistantQuestion('prices', current).paragraphs.join(' '), /91\.00/);
});

test('FAQ options explain scheduling limits, per-visit annual care and conditional confirmation without modifying bookings', () => {
  const original = structuredClone(catalogue);
  assert.match(answer('dates'), /14 calendar days.*Singapore time, Monday to Friday/);
  assert.match(answer('changes'), /72 hours before the original start time/);
  assert.match(answer('changes'), /new appointment must also be at least 72 hours ahead/);
  assert.match(answer('address'), /Annual bundle visits and combined Cleaning \+ Repair/);
  assert.match(answer('annual'), /two completed visits and two awaiting service means 2 of 4/);
  assert.match(answer('confirmation'), /Awaiting confirmation/);
  assert.match(answer('confirmation'), /visits 2–4.*do not automatically expire/);
  assert.deepEqual(catalogue, original);
});

test('FAQ rewards avoid assuming a fixed conversion and explain release, while mail replies do not promise delivery', () => {
  assert.match(answer('points'), /current conversion/);
  assert.match(answer('points'), /first visit/);
  assert.doesNotMatch(answer('points'), /100 points|S\$5/);
  assert.match(answer('returned-points'), /Unused reserved points/);
  assert.match(answer('returned-points'), /no points to return/);
  assert.match(answer('updates'), /after a successful technician assignment/);
  assert.match(answer('updates'), /Delivery depends/);
  assert.match(answer('support'), /Never include your password/);
});

test('every grouped dropdown question resolves to a curated answer and unknown questions are rejected', () => {
  assert.equal(new Set(assistantQuestions.map(item => item.id)).size, assistantQuestions.length);
  assert.ok(assistantQuestions.length >= 10);
  for (const item of assistantQuestions) {
    assert.ok(item.group);
    assert.equal(answerAssistantQuestion(item.id, catalogue).question, item.question);
    assert.ok(answerAssistantQuestion(item.id, catalogue).paragraphs.every(paragraph => paragraph.trim()));
  }
  assert.throws(() => answerAssistantQuestion('invented-question', catalogue), /Choose a question/);
});
