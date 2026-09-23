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
      <div className="sidebar-user">
        <span className="avatar">{technician?.initials || '—'}</span>
        <span>
          {technician?.name || 'Technician'}
          <small>{technician?.role || 'Field Technician'}</small>
        </span>
      </div>
    </aside>
  );
}
