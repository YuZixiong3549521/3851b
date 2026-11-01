const actionQueues = new Set([
  'reports',
  'expiring',
  'returns',
  'today',
  'active',
  'completed-week',
  'overdue-review',
]);
const planStatuses = new Set(['Active', 'Completed', 'Expired', 'Cancelled']);
const planAttention = new Set([
  'all',
  'unrenewed',
  'renewable',
  'expiring',
  'bonus',
  'bonus-soon',
  'reminder-due',
  'reminder-overdue',
  'contacted',
]);

export function adminOrderSearch(mode, params) {
  const specialQueue =
    mode === 'review' && actionQueues.has(params.get('queue'))
      ? params.get('queue')
      : '';
  const status = specialQueue
    ? ''
    : mode === 'review'
      ? ['Submitted', 'Rejected', 'Expired'].includes(params.get('status'))
        ? params.get('status')
        : 'Submitted'
      : 'Confirmed';
  const search = params.get('q')?.trim() || '';
  const allOrders = Boolean(search && params.get('scope') === 'all');
  const requestedPage = Number(params.get('page') || 1);
  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage >= 1 &&
    requestedPage <= 1000000
      ? requestedPage
      : 1;
  const query = new URLSearchParams({
    status,
    page: String(page),
    pageSize: '20',
    sort:
      specialQueue === 'expiring' || params.get('sort') === 'deadline'
        ? 'deadline'
        : 'placed',
  });
  if (specialQueue) query.set('queue', specialQueue);
  else if (mode === 'dispatch') query.set('queue', 'waiting');
  else if (status === 'Submitted' && params.get('sort') !== 'deadline')
    query.set('queue', 'review');
  if (search) query.set('q', search);
  if (allOrders) {
    query.delete('status');
    query.delete('queue');
  }
  return { specialQueue, status, search, allOrders, query };
}

export function readPlanFilters(params) {
  return {
    search: (params.get('q') || '').slice(0, 120),
    status: planStatuses.has(params.get('status')) ? params.get('status') : '',
    attention: planAttention.has(params.get('attention'))
      ? params.get('attention')
      : 'all',
  };
}

export function planFiltersUrl(params, changes) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (!['q', 'status', 'attention'].includes(key)) continue;
    if (!value || (key === 'attention' && value === 'all')) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return `/admin/plans${query ? '?' + query : ''}`;
}
