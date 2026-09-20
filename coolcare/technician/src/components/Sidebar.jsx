import LogoutButton from './LogoutButton.jsx';
import { NativeSelect } from '@/components/ui/native-select';
import {
  AirVent,
  LayoutDashboard,
  BriefcaseBusiness,
  FileText,
  UserRound,
} from 'lucide-react';

export default function Sidebar({ page, technician }) {
  return (
    <aside className="sidebar">
      <a aria-label="Technician Dashboard" className="brand" href="#dashboard">
        <span className="logo">
          <AirVent size={24} />
        </span>
        <span>
          AirCon<small>Maintenance</small>
        </span>
      </a>
      <div className="menu-label">MAIN MENU</div>
      <nav aria-label="Main navigation">
        {[
          ['dashboard', 'Dashboard', LayoutDashboard],
          ['jobs', 'My Jobs', BriefcaseBusiness],
          ['reports', 'Service Reports', FileText],
          ['profile', 'Profile', UserRound],
        ].map(([key, label, Icon]) => (
          <a
            aria-label={label}
            key={key}
            href={`#${key}`}
            className={page === key ? 'active' : ''}
            aria-current={page === key ? 'page' : undefined}
          >
            <Icon size={21} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <nav aria-label="Portal navigation">
        <label className="sr-only" htmlFor="portal-switch">
          Switch portal
        </label>
        <NativeSelect
          id="portal-switch"
          aria-label="Switch portal"
          defaultValue="technician"
          onChange={(event) => {
            window.location.href = event.target.value;
          }}
          style={{
            width: '100%',
            background: '#1e344b',
            color: '#c3d5e5',
            padding: '8px',
            border: '1px solid #263042',
            borderRadius: '6px',
            fontSize: '12px',
          }}
        >
          <option value="/">Home / Sign in</option>
          <option value="/customer">Customer</option>
          <option value="technician">Technician</option>
          <option value="/admin/orders">Admin</option>
        </NativeSelect>
      </nav>
      <div className="sidebar-user">
        <span className="avatar">{technician?.initials || '—'}</span>
        <span>
          {technician?.name || 'Technician'}
          <small>{technician?.role || 'Field Technician'}</small>
        </span>
      </div>
      <LogoutButton />
    </aside>
  );
}
