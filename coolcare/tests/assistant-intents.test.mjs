import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const faqUrl = `data:text/javascript;base64,${Buffer.from(compile(await readFile(new URL('../lib/assistant-faq.ts', import.meta.url), 'utf8'))).toString('base64')}`;
const compiled = compile(await readFile(new URL('../lib/assistant-intents.ts', import.meta.url), 'utf8')).replace(/from ['"]\.\/assistant-faq['"]/g, `from '${faqUrl}'`);
const { answerAssistantMessage, ASSISTANT_MESSAGE_LIMIT } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const catalogue = {
  services: [{ serviceId: 1, name: 'Cleaning', code: 'cleaning', basePrice: 47, additionalUnitPrice: 47 }, { serviceId: 2, name: 'Repair', code: 'repair', basePrice: 63, additionalUnitPrice: 0 }],
  bundles: [{ packageId: 3, name: 'Annual Cleaning Bundle', code: 'annual-cleaning', propertyPrices: [{ price: 390 }] }],
};
const ask = (text, options = catalogue) => answerAssistantMessage(text, options);
const body = text => ask(text).paragraphs.join(' ');

test('typed price questions use real catalogue values and preserve the user question', () => {
  const result = ask('  HOW MUCH is cleaning for 3 units?  ');
  assert.equal(result.question, 'HOW MUCH is cleaning for 3 units?');
  assert.match(result.paragraphs.join(' '), /47\.00 per unit/);
  assert.match(result.paragraphs.join(' '), /63\.00 minimum/);
  assert.doesNotMatch(result.paragraphs.join(' '), /141\.00|50\.00/);
  assert.match(ask('price', null).paragraphs.join(' '), /have not loaded/);
  assert.match(body('annual bundle price'), /390\.00 for four/);
});

test('specific English and Chinese keywords select guidance for the intended topic', () => {
  const cases = [
    ['Can I book next Saturday?', /14 calendar days/], ['周末可以预约吗', /Monday to Friday/],
    ['reschedule my appointment', /72 hours/], ['改期', /72 hours/],
    ['twice at the same address', /one cleaning appointment/], ['同一地址可以重复预约吗', /one cleaning appointment/],
    ['annual bundle', /four separate cleaning visits/], ['年度套餐', /four separate cleaning visits/],
    ['redeem points', /Select available loyalty points/], ['积分抵扣', /Select available loyalty points/],
    ['rejected booking points refund', /Unused reserved points are returned/], ['取消后积分退还吗', /Unused reserved points are returned/],
    ['extra repair charges', /minimum diagnostic fee/], ['额外维修费用', /minimum diagnostic fee/],
    ['is booking confirmed immediately?', /Awaiting confirmation/], ['confirmation email', /email is queued/],
    ['support email address', /Your own email application/], ['customer service contact', /Email support/],
    ['chemical or regular cleaning?', /technician decides/],
  ];
  for (const [text, expected] of cases) assert.match(body(text), expected, text);
});

test('booking text only offers the existing reviewed flow and does not mutate catalogue or submit', () => {
  const original = structuredClone(catalogue);
  for (const text of ['book a cleaning', 'I want to book', 'new booking', '我要预约']) {
    const answer = ask(text); assert.equal(answer.action, 'booking', text);
    assert.match(answer.paragraphs.join(' '), /does not submit a booking/);
  }
  assert.deepEqual(catalogue, original);
  for (const text of ["I don't want to book", 'do not book', 'not ready to book', '不要预约']) {
    assert.equal(ask(text).action, undefined, text);
    assert.match(body(text), /No booking has been created or changed/);
  }
  assert.match(body("I don't want to cancel, how much is cleaning?"), /47\.00/);
  assert.match(body("I don't want to cancel, I want to reschedule"), /72 hours/);
  assert.match(body('不想取消，我想改期'), /72 hours/);
  assert.match(body("I don't want to book, just show cleaning prices"), /47\.00/);
  assert.equal(ask("I don't want to book, just show cleaning prices").action, undefined);
  assert.match(body('I cannot book today'), /14 calendar days/);
});

test('ambiguous multi-topic text asks for clarification instead of selecting an unrelated answer', () => {
  assert.deepEqual(ask('price and cancellation').suggestions, ['prices', 'changes']);
  assert.deepEqual(ask('annual bundle points').suggestions, ['points', 'annual']);
  for (const text of ['booking', 'appointment', 'reservation', '预约']) {
    assert.equal(ask(text).action, 'booking');
    assert.deepEqual(ask(text).suggestions, ['dates', 'confirmation', 'changes']);
    assert.match(body(text), /Questions do not create or change/);
  }
  assert.match(body('appointment time'), /14 calendar days/);
  for (const word of ['appointing', 'disappointment', 'bookkeeper', 'costume', 'pointless', 'updatedness']) {
    assert.match(body(word), /could not match/, word);
  }
});

test('personal status and balances never become invented account lookups', () => {
  for (const text of ['Is my booking confirmed?', 'show my booking history', 'check my booking BK-2026-0719', '我的订单状态']) {
    assert.match(body(text), /does not retrieve individual orders/, text);
    assert.equal(ask(text).action, undefined);
  }
  for (const text of ['How many points do I have?', 'my points balance', '积分余额']) assert.match(body(text), /does not look up your balance/, text);
});

test('blank, long, unknown and social messages are bounded and answered honestly in English', () => {
  assert.match(body('  \n '), /Type a question/);
  const long = ask('price '.repeat(100));
  assert.equal(long.question.length, ASSISTANT_MESSAGE_LIMIT);
  assert.match(long.paragraphs.join(' '), /500 characters or fewer/);
  assert.equal(long.action, undefined);
  assert.match(body('你好'), /Hi!/);
  assert.match(body('thank you'), /welcome/);
  assert.match(body('Who won the world cup?'), /could not match/);
  assert.doesNotMatch(body('价格'), /[\u3400-\u9fff]/);
});
