import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminOrderSearch,
  planFiltersUrl,
  readPlanFilters,
} from '../lib/admin-navigation.mjs';

test('queue searches retain queue, deadline ordering and page while all-order searches explicitly remove only API filters', () => {
  const params = new URLSearchParams(
    'queue=expiring&q=Alice&page=2&sort=deadline',
  );
  const scoped = adminOrderSearch('review', params).query;
  assert.equal(scoped.get('queue'), 'expiring');
  assert.equal(scoped.get('q'), 'Alice');
  assert.equal(scoped.get('page'), '2');
  assert.equal(scoped.get('sort'), 'deadline');
  params.set('scope', 'all');
  const global = adminOrderSearch('review', params);
  assert.equal(global.allOrders, true);
  assert.equal(global.query.has('queue'), false);
  assert.equal(global.query.has('status'), false);
  assert.equal(
    params.get('queue'),
    'expiring',
    'the return queue remains in the browser URL',
  );
  params.delete('q');
  assert.equal(
    adminOrderSearch('review', params).query.get('queue'),
    'expiring',
  );
});

test('status and dispatch searches stay scoped by default and invalid pages fall back safely', () => {
  assert.equal(
    adminOrderSearch(
      'review',
      new URLSearchParams('status=Rejected&q=BK-2026-0021'),
    ).query.get('status'),
    'Rejected',
  );
  const dispatch = adminOrderSearch(
    'dispatch',
    new URLSearchParams('q=Alice'),
  ).query;
  assert.equal(dispatch.get('queue'), 'waiting');
  assert.equal(
    adminOrderSearch('review', new URLSearchParams('page=NaN')).query.get(
      'page',
    ),
    '1',
  );
  assert.equal(
    adminOrderSearch('review', new URLSearchParams('page=0')).query.get('page'),
    '1',
  );
});

test('annual-package URLs round trip search, status and attention without losing spaces or unrelated context', () => {
  const url = planFiltersUrl(
    new URLSearchParams('attention=reminder-overdue&context=overview'),
    { q: 'Alice Tan & family ', status: 'Active' },
  );
  const params = new URLSearchParams(url.split('?')[1]);
  assert.deepEqual(readPlanFilters(params), {
    search: 'Alice Tan & family ',
    status: 'Active',
    attention: 'reminder-overdue',
  });
  assert.equal(params.get('context'), 'overview');
  const reset = planFiltersUrl(params, { q: '', status: '', attention: 'all' });
  assert.equal(reset, '/admin/plans?context=overview');
  assert.deepEqual(
    readPlanFilters(new URLSearchParams('status=invalid&attention=invalid')),
    { search: '', status: '', attention: 'all' },
  );
});
