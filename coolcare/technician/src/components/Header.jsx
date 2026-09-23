import { CalendarDays } from 'lucide-react';
import { PortalAccountMenu } from '@/components/portal-account-menu';
import { formatDate } from '../utils/jobs.js';
export default function Header({ page, total, today, technician, user }) {
  return (
    <header className="header technician-header">
      <div>
        <h1>
          {{ jobs: 'My Jobs', reports: 'Service Reports', profile: 'Profile' }[
            page
          ] || 'Technician Dashboard'}
        </h1>
        <p>
          {page === 'reports' ? (
            'View and complete service reports'
          ) : page === 'profile' ? (
            'Manage your profile and availability'
          ) : page === 'jobs' ? (
            `${total} jobs assigned`
          ) : (
            <>
              Welcome back,{' '}
              <strong>{technician?.name?.split(' ')[0] || 'Technician'}</strong>
            </>
          )}
        </p>
      </div>
      <div className="technician-header-actions">
        <div className="header-date">
          <CalendarDays size={18} />
          {formatDate(today, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </div>
        <PortalAccountMenu
          user={{ ...user, name: technician?.name || user.name }}
          onNavigate={(href) => window.location.assign(href)}
        />
      </div>
    </header>
  );
}
