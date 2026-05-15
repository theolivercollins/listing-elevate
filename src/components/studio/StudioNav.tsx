import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/dashboard/studio', label: 'Queue', end: true },
  { to: '/dashboard/studio/clients', label: 'Clients', end: false },
];

export function StudioNav() {
  return (
    <nav className="flex gap-4 border-b mb-6">
      {tabs.map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `px-3 py-2 text-sm ${isActive ? 'border-b-2 border-foreground font-medium' : 'text-muted-foreground'}`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
