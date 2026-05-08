import type { ReactNode } from "react";

/**
 * Stroke-only iconography — ported verbatim from the Claude Design handoff
 * bundle (le-primitives.jsx). 24x24 viewBox, 1.6 stroke-width default.
 */
function buildIcons(color: string): Record<string, ReactNode> {
  return {
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    arrowUpRight: <path d="M7 17L17 7M8 7h9v9" />,
    check: <path d="M5 12l4 4 10-10" />,
    x: <path d="M6 6l12 12M18 6L6 18" />,
    play: <path d="M7 5v14l12-7z" />,
    download: (
      <>
        <path d="M12 4v12M6 12l6 6 6-6" />
        <path d="M4 20h16" />
      </>
    ),
    upload: (
      <>
        <path d="M12 20V8M6 12l6-6 6 6" />
        <path d="M4 4h16" />
      </>
    ),
    camera: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <circle cx="12" cy="13" r="4" />
        <path d="M8 7l2-3h4l2 3" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="2" />
        <path d="M4 18l5-5 4 4 3-3 4 4" />
      </>
    ),
    orbit: (
      <>
        <circle cx="12" cy="12" r="3" />
        <ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-20 12 12)" />
      </>
    ),
    dollyR: (
      <>
        <path d="M3 12h14M13 7l6 5-6 5" />
        <rect x="1" y="10" width="2" height="4" fill={color} stroke="none" />
      </>
    ),
    dollyL: (
      <>
        <path d="M21 12H7M11 7l-6 5 6 5" />
        <rect x="21" y="10" width="2" height="4" fill={color} stroke="none" />
      </>
    ),
    pan: <path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" />,
    pushIn: (
      <>
        <rect x="6" y="6" width="12" height="12" />
        <rect x="10" y="10" width="4" height="4" />
        <path d="M2 2l4 4M22 2l-4 4M2 22l4-4M22 22l-4-4" />
      </>
    ),
    parallax: <path d="M3 7h8M3 12h14M3 17h10" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33 1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82 1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    bell: (
      <>
        <path d="M6 8a6 6 0 1112 0c0 7 3 7 3 7H3s3 0 3-7" />
        <path d="M10 20a2 2 0 004 0" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </>
    ),
    film: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="1" />
        <path d="M7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />
      </>
    ),
    moon: <path d="M21 13A9 9 0 0111 3a7 7 0 1010 10z" />,
    sparkle: (
      <>
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5 5l2.5 2.5M16.5 16.5L19 19M5 19l2.5-2.5M16.5 7.5L19 5" />
      </>
    ),
    zap: <path d="M13 3L4 14h7l-1 7 9-11h-7z" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    dollar: (
      <>
        <path d="M12 2v20" />
        <path d="M17 6H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M10 11v6M14 11v6" />
        <path d="M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13" />
        <path d="M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
      </>
    ),
    more: (
      <>
        <circle cx="6" cy="12" r="1" fill={color} />
        <circle cx="12" cy="12" r="1" fill={color} />
        <circle cx="18" cy="12" r="1" fill={color} />
      </>
    ),
    bed: (
      <>
        <path d="M3 18v-6a2 2 0 012-2h11a3 3 0 013 3v5" />
        <path d="M3 14h18M3 20v-2M21 20v-2" />
        <circle cx="8" cy="12" r="1.5" />
      </>
    ),
    bath: (
      <>
        <path d="M4 12h16v3a4 4 0 01-4 4H8a4 4 0 01-4-4v-3z" />
        <path d="M6 12V6a2 2 0 012-2 2 2 0 012 2M4 19l-1 2M20 19l1 2" />
      </>
    ),
    ruler: <path d="M2 12l10-10 10 10-10 10zM6 12l1 1M10 8l1 1M14 12l1 1M10 16l1 1" />,
    plus: (
      <>
        <rect x="11" y="4" width="2" height="16" />
        <rect x="4" y="11" width="16" height="2" />
      </>
    ),
    minus: <rect x="4" y="11" width="16" height="2" />,
  };
}

// Static name union so consumers can narrow to valid icon keys.
export type LEIconName =
  | "arrow"
  | "arrowUpRight"
  | "check"
  | "x"
  | "play"
  | "download"
  | "upload"
  | "camera"
  | "image"
  | "orbit"
  | "dollyR"
  | "dollyL"
  | "pan"
  | "pushIn"
  | "parallax"
  | "settings"
  | "menu"
  | "bell"
  | "search"
  | "film"
  | "sun"
  | "moon"
  | "sparkle"
  | "zap"
  | "clock"
  | "dollar"
  | "trash"
  | "more"
  | "bed"
  | "bath"
  | "ruler"
  | "plus"
  | "minus";

interface LEIconProps {
  name: LEIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function LEIcon({
  name,
  size = 16,
  color = "currentColor",
  strokeWidth = 1.6,
}: LEIconProps) {
  const icons = buildIcons(color);
  const child = icons[name] ?? icons.arrow;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {child}
    </svg>
  );
}
