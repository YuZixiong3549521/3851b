import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendedTeamSize, teamDuration } from '../lib/team-rules.mjs';
import { peakConcurrentReservations } from '../server/scheduling.mjs';
test('automatic teams cover every four-unit boundary through twenty units', () => {
  for (const [units, count] of [
    [1, 1],
    [4, 1],
    [5, 2],
    [8, 2],
    [9, 3],
    [12, 3],
    [13, 4],
    [16, 4],
    [17, 5],
    [20, 5],
  ])
    assert.equal(recommendedTeamSize(units), count);
});
test('parallel cleaning rounds each member workload up and preserves diagnostics', () => {
  assert.equal(teamDuration(8, 2, 45), 180);
  assert.equal(teamDuration(5, 2, 45, 60), 195);
  assert.equal(teamDuration(8, 1, 45), 360);
  assert.equal(teamDuration(8, 3, 45), 135);
  assert.equal(teamDuration(20, 5, 0, 60), 60);
});
test('capacity counts every member and releases slots at interval boundaries', () => {
  assert.equal(
    peakConcurrentReservations(
      [
        { start: '09:00', end: '12:00', technicians: 3 },
        { start: '10:00', end: '11:00', technicians: 2 },
        { start: '12:00', end: '13:00', technicians: 5 },
      ],
      '09:00',
      '13:00',
    ),
    5,
  );
});
