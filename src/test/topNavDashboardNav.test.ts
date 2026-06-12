/**
 * TopNav — dashboardNav removal test (Task C).
 *
 * Confirms that the duplicate `dashboardNav` constant that used to live in
 * TopNav.tsx (lines ~40, 213, 234) has been deleted, so the sidebar is the
 * single navigation system.
 *
 * NOTE: This is a file-content assertion test. It reads the source file and
 * asserts the absence of the pattern. This is intentional for a "grep-style"
 * structural check that survives tree-shaking and bundler transforms.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const TOP_NAV_PATH = resolve(__dirname, "../components/TopNav.tsx");

describe("TopNav — dashboardNav removed", () => {
  let source: string;

  try {
    source = readFileSync(TOP_NAV_PATH, "utf-8");
  } catch {
    source = "";
  }

  it("TopNav.tsx file exists", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("does NOT contain the dashboardNav constant declaration", () => {
    // The old pattern: `const dashboardNav = [`
    expect(source).not.toMatch(/const\s+dashboardNav\s*=/);
  });

  it("does NOT contain dashboardNav in the dashboard sub-nav rendering", () => {
    // Check for uses like dashboardNav.slice(0, -1).map or dashboardNav.map
    expect(source).not.toMatch(/dashboardNav\s*\./);
    expect(source).not.toMatch(/dashboardNav\s*\[/);
  });

  it("still contains the account menu (DropdownMenu/DropdownMenuTrigger)", () => {
    // Non-nav chrome (account menu) must still be present
    expect(source).toMatch(/DropdownMenu/);
  });

  it("does NOT render the dashboard horizontal nav section", () => {
    // The nav element that used to render dashboardNav items
    // Check for inDashboard && isAdmin nav block — it should be removed
    expect(source).not.toMatch(/inDashboard\s*&&\s*isAdmin.*?<nav/s);
  });
});
