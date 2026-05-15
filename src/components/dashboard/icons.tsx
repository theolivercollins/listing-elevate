import type { CSSProperties, SVGProps } from "react";

export type IconName =
  | "grid"
  | "pipeline"
  | "home"
  | "logs"
  | "dollar"
  | "beaker"
  | "book"
  | "branch"
  | "activity"
  | "image"
  | "search"
  | "bell"
  | "plus"
  | "chevron-down"
  | "chevron-right"
  | "chevron-up"
  | "arrow-up"
  | "arrow-down"
  | "trend-up"
  | "trend-down"
  | "check"
  | "x"
  | "retry"
  | "skip"
  | "alert"
  | "clock"
  | "play"
  | "upload"
  | "filter"
  | "sliders"
  | "spark"
  | "cube"
  | "dots"
  | "settings"
  | "user"
  | "users"
  | "cmd"
  | "sparkles"
  | "external"
  | "logo";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}

export function Icon({ name, size = 18, strokeWidth = 1.6, style, ...rest }: IconProps) {
  if (name === "logo") {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={style} {...rest}>
        <rect x="2" y="2" width="28" height="28" rx="8" fill="#0e1424" />
        <path d="M9 22V10h3v9h7v3z" fill="#fff" opacity="0.95" />
        <circle cx="22" cy="11" r="2" fill="#fff" opacity="0.85" />
      </svg>
    );
  }
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style,
    ...rest,
  };
  switch (name) {
    case "grid":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "pipeline":
      return (
        <svg {...common}>
          <path d="M3 6h6l3 3h9" />
          <path d="M3 18h6l3-3h9" />
          <circle cx="6" cy="6" r="1.6" />
          <circle cx="6" cy="18" r="1.6" />
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <path d="M4 11l8-6 8 6" />
          <path d="M5.5 10v9h13v-9" />
          <path d="M10 19v-5h4v5" />
        </svg>
      );
    case "logs":
      return (
        <svg {...common}>
          <path d="M5 4h11l4 4v12H5z" />
          <path d="M16 4v4h4" />
          <path d="M9 12h7M9 16h7M9 8h3" />
        </svg>
      );
    case "dollar":
      return (
        <svg {...common}>
          <path d="M12 3v18" />
          <path d="M16 7c-1-1.4-2.6-2-4-2-2 0-4 1-4 3s2 2.6 4 3 4 1 4 3-2 3-4 3c-1.6 0-3-.6-4-2" />
        </svg>
      );
    case "beaker":
      return (
        <svg {...common}>
          <path d="M9 3h6M10 3v6L4 19a2 2 0 0 0 1.7 3h12.6A2 2 0 0 0 20 19L14 9V3" />
          <path d="M7 14h10" />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          <path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z" />
          <path d="M20 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" />
        </svg>
      );
    case "branch":
      return (
        <svg {...common}>
          <circle cx="6" cy="5" r="2" />
          <circle cx="6" cy="19" r="2" />
          <circle cx="18" cy="12" r="2" />
          <path d="M6 7v10" />
          <path d="M6 12c4 0 6-2 6-5" />
          <path d="M16 12H8" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <path d="M3 12h4l3-8 4 16 3-8h4" />
        </svg>
      );
    case "image":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 16l-5-5L5 21" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...common}>
          <path d="m9 6 6 6-6 6" />
        </svg>
      );
    case "chevron-up":
      return (
        <svg {...common}>
          <path d="m6 15 6-6 6 6" />
        </svg>
      );
    case "arrow-up":
      return (
        <svg {...common}>
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      );
    case "arrow-down":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      );
    case "trend-up":
      return (
        <svg {...common}>
          <path d="m22 7-9 9-4-4-7 7" />
          <path d="M16 7h6v6" />
        </svg>
      );
    case "trend-down":
      return (
        <svg {...common}>
          <path d="m22 17-9-9-4 4-7-7" transform="translate(0 24) scale(1 -1)" />
          <path d="M16 17h6v-6" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 5 5 9-11" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case "retry":
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
        </svg>
      );
    case "skip":
      return (
        <svg {...common}>
          <path d="M5 4v16M19 4l-10 8 10 8z" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 2 2 21h20z" />
          <path d="M12 10v5M12 18.5v.5" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "play":
      return (
        <svg {...common}>
          <path d="M7 5v14l12-7z" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M17 8l-5-5-5 5" />
          <path d="M12 3v14" />
        </svg>
      );
    case "filter":
      return (
        <svg {...common}>
          <path d="M3 5h18M6 12h12M10 19h4" />
        </svg>
      );
    case "sliders":
      return (
        <svg {...common}>
          <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
          <circle cx="4" cy="12" r="2" />
          <circle cx="12" cy="10" r="2" />
          <circle cx="20" cy="14" r="2" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M5 12c4-8 10-8 14 0" />
          <path d="M5 12c4 8 10 8 14 0" />
        </svg>
      );
    case "cube":
      return (
        <svg {...common}>
          <path d="M12 3 4 7v10l8 4 8-4V7z" />
          <path d="M4 7l8 4 8-4M12 11v10" />
        </svg>
      );
    case "dots":
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.4" />
          <circle cx="12" cy="12" r="1.4" />
          <circle cx="19" cy="12" r="1.4" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1A1.7 1.7 0 0 0 4.8 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8L4.2 7a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.1V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.7 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.1.7.7 1.2 1.5 1.2H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M3 20c1-3.5 3.5-5.5 6-5.5s5 2 6 5.5" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M15 14c2 0 4.5 1.5 6 4" />
        </svg>
      );
    case "cmd":
      return (
        <svg {...common}>
          <path d="M6 3a3 3 0 1 1-3 3h12a3 3 0 1 1-3-3v12a3 3 0 1 1 3-3H6a3 3 0 1 1 3 3z" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...common}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" />
        </svg>
      );
    case "external":
      return (
        <svg {...common}>
          <path d="M14 4h6v6" />
          <path d="M20 4l-9 9" />
          <path d="M14 12v6H5V8h6" />
        </svg>
      );
    default:
      return null;
  }
}
