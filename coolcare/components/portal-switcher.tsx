'use client';

export function PortalSwitcher({ current }: { current: 'customer' | 'inventory' }) {
  return <select aria-label="Switch portal" value={current}
    onChange={event => window.location.assign({home:'/',customer:'/customer',technician:'/technician/index.html',inventory:'/admin/inventory'}[event.target.value] ?? '/customer')}
    className="max-w-32 rounded-lg border border-border bg-white px-2 py-2 text-sm text-foreground">
    <option value="home">Home</option>
    <option value="customer">Customer</option>
    <option value="technician">Technician</option>
    <option value="inventory">Inventory</option>
  </select>;
}
