const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';

const checks = [
  { path: '/api/health', validate: (body) => body.status === 'ok' },
  { path: '/api/customer-context', validate: (body) => body.customer?.email === 'alice.tan@coolcare.demo' && body.units?.length >= 1 },
  { path: '/api/services', validate: (body) => body.services?.length >= 1 },
  { path: '/api/bookings/history', validate: (body) => body.bookings?.some((booking) => booking.status === 'Completed') },
];

for (const check of checks) {
  const response = await fetch(`${apiBaseUrl}${check.path}`);
  const body = /** @type {Record<string, any>} */ (await response.json());
  if (!response.ok || !check.validate(body)) throw new Error(`Smoke check failed for ${check.path}`);
  console.log(`PASS ${check.path}`);
}
