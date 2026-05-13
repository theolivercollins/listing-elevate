import type { CSSProperties, ReactNode } from "react";

type Padding = "none" | "sm" | "md" | "lg";

const PAD: Record<Padding, string> = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export function DashboardCard({
  children,
  padding = "md",
  className = "",
  style,
}: {
  children: ReactNode;
  padding?: Padding;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`rounded-[14px] border ${PAD[padding]} ${className}`}
      style={{
        background: "var(--le-bg-elev)",
        borderColor: "var(--le-border)",
        boxShadow: "var(--le-shadow-md)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
