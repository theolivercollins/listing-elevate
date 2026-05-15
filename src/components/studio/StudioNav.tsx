import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/dashboard/studio', label: 'Queue', end: true },
  { to: '/dashboard/studio/clients', label: 'Clients', end: false },
];

/**
 * StudioNav — segmented control rendered under the Studio section heading.
 * Styled as a pill-shaped segmented control per the Glass design system:
 *   outer wrapper: rgba(11,11,16,0.04) pill background
 *   active tab: var(--le-ink) fill with white text
 *   inactive tab: transparent, var(--le-muted) text
 *
 * Must be rendered inside a .studio-scope wrapper so tokens resolve.
 */
export function StudioNav() {
  return (
    <nav className="studio-segmented" aria-label="Studio sections">
      {tabs.map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            'studio-segmented-item' + (isActive ? ' active' : '')
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
