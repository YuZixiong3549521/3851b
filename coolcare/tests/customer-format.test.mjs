import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const source = await readFile(new URL('../lib/format.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64');
const { formatDate, formatDateTime, formatTimeSlot } = await import(moduleUrl);

test('customer dates stay English and calendar dates do not move in a Chinese locale or overseas time zone', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { formatDate, formatDateTime } = await import(${JSON.stringify(moduleUrl)});
    process.stdout.write(JSON.stringify([
      formatDate('2026-09-28'),
      formatDate('2026-09-28', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      formatDateTime('2026-09-12 10:30:00'),
      formatDateTime('2026-09-12T02:30:00Z')
    ]));
  `], { encoding: 'utf8', env: { ...process.env, LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8', TZ: 'Pacific/Honolulu' } });
  assert.equal(result.status, 0, result.stderr);
  const values = JSON.parse(result.stdout);
  assert.match(values[0], /^28 Sep(?:t)? 2026$/);
  assert.match(values[1], /Monday.*28 September 2026/);
  assert.match(values[2], /12 Sep(?:t)? 2026.*10:30.*am/i);
  assert.equal(values[2], values[3], 'SQL local time and UTC instant identify the same Singapore time');
  assert.ok(values.every(value => !/[\u3400-\u9fff]/u.test(value)));
});

test('legacy AM/PM and current 24-hour slots have consistent English labels', () => {
  assert.equal(formatTimeSlot('14:00 - 16:00'), '02:00 PM – 04:00 PM');
  assert.equal(formatTimeSlot('02:00 PM - 04:00 PM'), '02:00 PM – 04:00 PM');
  assert.equal(formatTimeSlot('00:00 - 12:00'), '12:00 AM – 12:00 PM');
  assert.equal(formatTimeSlot('11:30 AM - 01:30 PM'), '11:30 AM – 01:30 PM');
});

test('missing and invalid historical date values render an honest fallback', () => {
  assert.equal(formatDate('2026-02-30'), 'Date unavailable');
  assert.equal(formatDate('unknown'), 'Date unavailable');
  assert.equal(formatDateTime(null), 'Date and time unavailable');
  assert.equal(formatDateTime('unknown'), 'Date and time unavailable');
  assert.equal(formatTimeSlot(null), 'Time to be confirmed');
});

test('explicit UTC report timestamps convert to Singapore time in English', () => {
  assert.match(formatDateTime('2026-09-12T09:00:00Z'), /12 Sep(?:t)? 2026.*05:00.*pm/i);
});
