import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

const asModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const scheduleSource = await readFile(new URL('../lib/booking-schedule.ts', import.meta.url), 'utf8');
const scheduleUrl = asModule(ts.transpileModule(scheduleSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText);
let serviceSource = await readFile(new URL('../technician/src/services/jobService.js', import.meta.url), 'utf8');
for (const [specifier, url] of Object.entries({
  '../data/mockJobs.js': new URL('../technician/src/data/mockJobs.js', import.meta.url).href,
  '@/lib/portal-session.mjs': new URL('../lib/portal-session.mjs', import.meta.url).href,
  '@/lib/booking-schedule': scheduleUrl,
})) serviceSource = serviceSource.replaceAll(`'${specifier}'`, JSON.stringify(url));
// Supply the same build-time environment that Vite injects without making HTTP calls.
const liveService = asModule(serviceSource.replaceAll('import.meta.env', '({})'));
const demoService = asModule(serviceSource.replaceAll('import.meta.env', '({VITE_USE_MOCK:"true"})'));
const jobsUrl = new URL('../technician/src/utils/jobs.js', import.meta.url).href;

test('technician Today and Upcoming use the Singapore date across overseas midnight and year boundaries', () => {
  for (const zone of ['Pacific/Honolulu', 'Pacific/Kiritimati', 'Asia/Shanghai']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const {getPortalDate} = await import(${JSON.stringify(liveService)});
      const {filterJobs,getStats} = await import(${JSON.stringify(jobsUrl)});
      const jobs = [
        {id:'WO-1',customer:'Test',date:'2026-12-31',status:'Assigned'},
        {id:'WO-2',customer:'Test',date:'2027-01-01',status:'Assigned'},
        {id:'WO-3',customer:'Test',date:'2027-01-02',status:'Assigned'}
      ];
      const dates = ['2026-12-31T15:59:59Z','2026-12-31T16:00:00Z'].map(value=>getPortalDate(new Date(value)));
      console.log(JSON.stringify({dates,today:filterJobs(jobs,{tab:'Today'},dates[1]).map(j=>j.id),upcoming:filterJobs(jobs,{tab:'Upcoming'},dates[1]).map(j=>j.id),stats:getStats(jobs,dates[1])}));
    `], { encoding: 'utf8', env: { ...process.env, TZ: zone, LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8' } });
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.deepEqual(value.dates, ['2026-12-31', '2027-01-01'], zone);
    assert.deepEqual(value.today, ['WO-2']);
    assert.deepEqual(value.upcoming, ['WO-3']);
    assert.equal(value.stats.today, 1);
    assert.equal(value.stats.upcoming, 1);
  }
});

test('the optional static technician preview retains its supplied demonstration date', async () => {
  const { getPortalDate } = await import(demoService);
  const { DEMO_DATE } = await import(new URL('../technician/src/data/mockJobs.js', import.meta.url));
  assert.equal(getPortalDate(new Date('2027-01-01T00:00:00Z')), DEMO_DATE);
});
