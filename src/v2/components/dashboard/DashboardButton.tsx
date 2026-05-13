import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "destructive";
type Size = "sm" | "md";

const VARIANT_STYLE: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: "var(--le-accent)", fg: "var(--le-accent-fg)", border: "var(--le-accent)" },
  ghost: { bg: "var(--le-bg-elev)", fg: "var(--le-text)", border: "var(--le-border)" },
  destructive: { bg: "transparent", fg: "var(--le-danger)", border: "var(--le-border)" },
};

const SIZE_STYLE: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3 text-sm",
};

export interface DashboardButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export function DashboardButton({
  variant = "ghost",
  size = "md",
  leftIcon,
  rightIcon,
  className = "",
  style,
  children,
  ...rest
}: DashboardButtonProps) {
  const { bg, fg, border } = VARIANT_STYLE[variant];
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-1.5 rounded-[8px] border font-medium transition-colors ${SIZE_STYLE[size]} ${className}`}
      style={{ background: bg, color: fg, borderColor: border, ...style }}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}
