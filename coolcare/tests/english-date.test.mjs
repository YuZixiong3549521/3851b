import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

async function helperModule(file) {
  const source = await readFile(new URL('../lib/' + file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return 'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64');
}
const dateModule = await helperModule('english-date.ts');
const formatModule = await helperModule('format.ts');
const scheduleModule = await helperModule('booking-schedule.ts');
const { calendarDateUnavailable, parseCalendarDate, englishCalendarDate } = await import(dateModule);

test('English dates retain the selected calendar day under Chinese language and distant system time zones', () => {
  for (const timeZone of ['Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    const script = `const date = await import(${JSON.stringify(dateModule)}); const format = await import(${JSON.stringify(formatModule)}); const schedule = await import(${JSON.stringify(scheduleModule)}); console.log(JSON.stringify({ defaultLocale: new Intl.DateTimeFormat().resolvedOptions().locale, picker: date.englishCalendarDate('2026-09-28'), roundTrip: date.calendarDateValue(date.parseCalendarDate('2026-09-28')), display: format.formatDate('2026-09-28'), invalid: schedule.bookingDateError('2026-09-25',new Date('2026-09-12T04:00:00Z')) }));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8', TZ: timeZone }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout.trim());
    assert.match(value.defaultLocale, /^zh/);
    assert.equal(value.picker, '28 Sep 2026');
    assert.equal(value.roundTrip, '2026-09-28');
    assert.match(value.display, /28 Sept? 2026/);
    assert.match(value.invalid, /28 Sept? 2026/);
    assert.doesNotMatch(value.display + value.invalid, /[\u3400-\u9fff]/);
  }
});

test('calendar disables short notice, both weekend days, address conflicts and dates outside a quarterly window', () => {
  const limits = { min: '2026-09-28', max: '2026-10-05', disableWeekends: true, blockedDates: ['2026-09-30'] };
  for (const blocked of ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-30', '2026-10-03', '2026-10-04', '2026-10-06']) assert.equal(calendarDateUnavailable(blocked, limits), true, blocked);
  for (const available of ['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-02', '2026-10-05']) assert.equal(calendarDateUnavailable(available, limits), false, available);
});

test('calendar rejects impossible dates and preserves leap dates without JavaScript rollover', () => {
  for (const invalid of ['', '2026-02-29', '2026-02-30', '2026-13-01', '28/09/2026']) {
    assert.equal(parseCalendarDate(invalid), undefined);
    assert.equal(englishCalendarDate(invalid), '');
    assert.equal(calendarDateUnavailable(invalid), true);
  }
  assert.equal(englishCalendarDate('2028-02-29'), '29 Feb 2028');
});
