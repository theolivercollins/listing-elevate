import { useState, type ReactNode } from "react";

type TabKey = "overview" | "deliverables" | "activity";

interface Tab {
  key: TabKey;
  label: string;
  count?: number | null;
  content: ReactNode;
}

interface Props {
  tabs: Tab[];
  defaultTab?: TabKey;
}

export function OrderDetailTabs({ tabs, defaultTab = "overview" }: Props) {
  const [active, setActive] = useState<TabKey>(defaultTab);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div>
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--le-border)" }}>
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              style={{
                padding: "10px 14px",
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${isActive ? "var(--le-text)" : "transparent"}`,
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: "-0.005em",
                color: isActive ? "var(--le-text)" : "var(--le-text-muted)",
                cursor: "pointer",
              }}
            >
              {t.label}
              {typeof t.count === "number" && (
                <span
                  style={{
                    marginLeft: 6,
                    fontFamily: "var(--le-font-mono)",
                    fontSize: 11,
                    color: "var(--le-text-faint)",
                  }}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ paddingTop: 24 }}>{current.content}</div>
    </div>
  );
}
