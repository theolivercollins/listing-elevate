import { Outlet, NavLink } from "react-router-dom";
import { FileVideo, CreditCard, User } from "lucide-react";
import { SiteNav } from "@/v2/components/SiteNav";
import "@/v2/styles/v2.css";

const navItems = [
  { to: "/account/properties", label: "Listings", icon: FileVideo },
  { to: "/account/billing", label: "Billing", icon: CreditCard },
  { to: "/account/profile", label: "Brand", icon: User },
];

export default function Account() {
  return (
    <div
      className="le-root"
      style={{ minHeight: "100vh", background: "var(--le-bg)", color: "var(--le-text)", paddingTop: 80, fontFamily: "var(--le-font-sans)" }}
    >
      <SiteNav showSectionLinks={false} solid />
      <div style={{ borderBottom: "1px solid var(--le-border)" }}>
        <div className="mx-auto flex max-w-[1280px] items-end justify-between gap-6 px-8 pb-6 pt-12 md:px-12">
          <div>
            <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--le-text-muted)" }}>— Account</span>
            <h1 style={{ marginTop: 12, fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 500, letterSpacing: "-0.035em", color: "var(--le-text)", fontFamily: "var(--le-font-sans)" }}>Your studio</h1>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1280px] items-center gap-8 px-8 md:px-12">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              style={({ isActive }) => ({
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "16px 0",
                fontSize: 11,
                fontWeight: 500,
                textTransform: "uppercase" as const,
                letterSpacing: "0.18em",
                fontFamily: "var(--le-font-sans)",
                textDecoration: "none",
                color: isActive ? "var(--le-text)" : "var(--le-text-muted)",
                borderBottom: isActive ? "1px solid var(--le-text)" : "1px solid transparent",
                transition: "color 0.3s",
              })}
            >
              <Icon style={{ width: 13, height: 13 }} strokeWidth={1.5} />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>

      <main className="mx-auto max-w-[1280px] px-8 py-16 md:px-12 md:py-20">
        <Outlet />
      </main>
    </div>
  );
}
