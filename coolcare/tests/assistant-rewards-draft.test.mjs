import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function moduleUrl(relativePath, replacements = {}) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  for (const [specifier, target] of Object.entries(replacements)) {
    outputText = outputText.replaceAll(`'${specifier}'`, JSON.stringify(target)).replaceAll(`"${specifier}"`, JSON.stringify(target));
  }
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

const scheduleUrl = await moduleUrl('../lib/booking-schedule.ts');
const annualUrl = await moduleUrl('../lib/annual-booking.ts', { './booking-schedule': scheduleUrl });
const fetchUrl = await moduleUrl('../components/public-site/api.ts');
const assistantUrl = await moduleUrl('../lib/assistant-api.ts', {
  '@/components/public-site/api': fetchUrl,
  '@/lib/annual-booking': annualUrl,
});
const { emptyAssistantDraft, sameAssistantDraft, verifyAssistantState } = await import(assistantUrl);

test('lost assistant save recovery distinguishes points changes and keeps legacy zero-point drafts compatible', () => {
  const selected = { ...emptyAssistantDraft, step: 'review', rewardPoints: 200 };
  assert.equal(sameAssistantDraft(selected, structuredClone(selected)), true);
  assert.equal(sameAssistantDraft(selected, { ...selected, rewardPoints: 100 }), false);
  assert.equal(sameAssistantDraft(selected, { ...selected, rewardPoints: 0 }), false);
  const legacy = { ...emptyAssistantDraft };
  delete legacy.rewardPoints;
  assert.equal(sameAssistantDraft(emptyAssistantDraft, legacy), true);
});

test('a completed assistant booking cannot silently omit or change the points selected at creation', () => {
  const state = {
    userId: 77,
    draftId: 'saved-assistant-draft',
    revision: 4,
    status: 'completed',
    draft: { ...emptyAssistantDraft, rewardPoints: 100 },
    booking: { id: 123, status: 'Submitted', totalAmount: 50 },
  };
  assert.throws(() => verifyAssistantState(state, 77), /could not be fully verified/);
  state.booking.rewardReservation = { bookingId: 123, points: 200, discount: 10, status: 'Reserved' };
  assert.throws(() => verifyAssistantState(state, 77), /could not be fully verified/);
  state.booking.rewardReservation = { bookingId: 123, points: 100, discount: 5, status: 'Reserved' };
  assert.doesNotThrow(() => verifyAssistantState(state, 77));
  assert.throws(() => verifyAssistantState(state, 78), /signed-in account changed/);
});
