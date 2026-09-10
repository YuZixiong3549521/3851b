import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mockJobs,DEMO_DATE} from '../data/mockJobs.js';
import {filterJobs,getStats,formatTime} from './jobs.js';
test('shared dataset drives dashboard and tabs consistently',()=>{const s=getStats(mockJobs,DEMO_DATE);assert.equal(s.total,14);assert.equal(s.today,4);assert.equal(s.upcoming,5);assert.equal(s.completed,5);assert.equal(s.inProgress,1);assert.equal(s.pending,1);assert.equal(filterJobs(mockJobs,{tab:'Today'},DEMO_DATE).length,s.today);});
test('search, tab and all filters combine; contradictory filters give an empty result',()=>{const f={tab:'Today',query:'  ROBERT ',date:DEMO_DATE,status:'Pending',priority:'Urgent'};assert.deepEqual(filterJobs(mockJobs,f,DEMO_DATE).map(j=>j.id),['AC-2844']);assert.equal(filterJobs(mockJobs,{...f,status:'Completed'},DEMO_DATE).length,0);assert.equal(filterJobs(mockJobs,{query:'ac-2842'},DEMO_DATE)[0].customer,'James Wong');});
test('completed future jobs never count as upcoming',()=>{assert.equal(filterJobs([{...mockJobs[0],date:'2026-09-02',status:'Completed'}],{tab:'Upcoming'},DEMO_DATE).length,0);});
test('time handles midnight and noon',()=>{assert.equal(formatTime('00:00'),'12:00 AM');assert.equal(formatTime('12:00'),'12:00 PM');assert.equal(formatTime('14:30'),'02:30 PM');});
