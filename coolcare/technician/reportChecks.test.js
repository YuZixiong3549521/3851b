import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChecks, summarizeChecks } from './src/utils/reportChecks.js';
test('checklist round-trips completed checks and unfinished reasons without inventing legacy results', () => {
 const rows=[{name:'Drainage check',done:true,reason:''},{name:'Repair / replacement',done:false,reason:'Part unavailable'}];
 assert.deepEqual(parseChecks(summarizeChecks(rows)),rows);
 assert.deepEqual(parseChecks('Older handwritten report'),[]);
});
