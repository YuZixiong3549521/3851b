import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../lib/booking-schedule.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {earliestChangeDate,rescheduleDateError}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));

test('rescheduling enforces the exact 72-hour Singapore boundary and moves weekend minimum dates to Monday',()=>{
  const now=new Date('2026-09-25T02:30:00Z'); // Friday 10:30 SGT
  assert.equal(earliestChangeDate(now),'2026-09-28');
  assert.match(rescheduleDateError('2026-09-28','09:00 - 11:00',now),/72 hours/);
  assert.equal(rescheduleDateError('2026-09-28','10:30 AM - 12:30 PM',now),'');
  assert.equal(rescheduleDateError('2026-09-28','11:00 - 13:00',now),'');
  assert.match(rescheduleDateError('2026-09-27','14:00 - 16:00',now),/Weekend/);
  assert.equal(earliestChangeDate(new Date('2026-09-23T03:00:00Z')),'2026-09-28');
  assert.match(rescheduleDateError('2026-02-30','11:00 - 13:00',now),/valid preferred/);
});
