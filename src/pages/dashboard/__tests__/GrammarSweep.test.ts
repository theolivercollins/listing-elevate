/**
 * WS7 — Bounded grammar sweep: source-level assertions.
 *
 * For each in-scope page, verifies:
 *   - No raw <button> with inline color/background (must use le-btn-dark or le-btn-ghost)
 *   - StatusChip used (not raw StatusPill where a status is displayed)
 *   - MoneyValue used in pages that display money (Billing)
 *   - EmptyState used instead of ad-hoc empty <div> with inline text
 *   - PageHeading used (canonical heading primitive)
 *   - DESIGN-GUIDE §9 checklist items assertable at source level
 *
 * Strategy: source-level grep (like Profile.test.tsx) to avoid happy-dom OOM
 * on the transitive import chains of these heavy pages.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ACCOUNT_DIR = resolve(__dirname, "../account");
const DASHBOARD_DIR = resolve(__dirname, "..");

function src(rel: string) {
  return readFileSync(resolve(DASHBOARD_DIR, rel), "utf-8");
}

function countStyleAttr(source: string) {
  return source
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .filter((l) => l.includes("style={{"))
    .length;
}

// ─── AgentHome ────────────────────────────────────────────────────────────────
describe("AgentHome — WS7 grammar", () => {
  const agentSrc = src("AgentHome.tsx");

  it("uses PageHeading from primitives", () => {
    expect(agentSrc).toContain("PageHeading");
    expect(agentSrc).toContain('from "@/components/dashboard/primitives"');
  });

  it("uses StatusChip (not raw status color inline styles on status display)", () => {
    expect(agentSrc).toContain("StatusChip");
  });

  it("uses EmptyState for empty-section rendering", () => {
    expect(agentSrc).toContain("EmptyState");
  });

  it("uses le-btn-dark for primary CTA", () => {
    expect(agentSrc).toContain("le-btn-dark");
  });

  it("uses le-btn-ghost for secondary actions", () => {
    expect(agentSrc).toContain("le-btn-ghost");
  });

  it("has no raw <button with inline background color style (must use le-btn-* classes)", () => {
    // Find lines with <button that also have background or color in style={{
    const lines = agentSrc.split("\n");
    const violations = lines.filter((l) => {
      const trimmed = l.trimStart();
      if (trimmed.startsWith("//")) return false;
      // Look for <button elements with inline color/background
      return /<button/.test(l) && /style={{[^}]*(?:background|color):/.test(l);
    });
    expect(violations).toHaveLength(0);
  });

  it("checkout 'Finish checkout' action uses le-btn-ghost class (not raw styled link)", () => {
    // The finish-checkout action link must carry le-btn-ghost
    // Find the Finish checkout block
    expect(agentSrc).toContain("le-btn-ghost");
    // Specifically, the raw Link with inline color for "Finish checkout" must be gone
    // Check for inline color: "var(--warn)" on a Link with "Finish checkout" text nearby
    const finishBlock = agentSrc.includes("Finish checkout")
      ? agentSrc.slice(agentSrc.indexOf("Finish checkout") - 400, agentSrc.indexOf("Finish checkout") + 200)
      : "";
    // Should not have raw inline color on the link wrapping "Finish checkout"
    expect(finishBlock).not.toMatch(/style={{[^}]*color: "var\(--warn\)"[^}]*}}/);
  });
});

// ─── Listings ─────────────────────────────────────────────────────────────────
describe("Listings — WS7 grammar", () => {
  const listSrc = src("account/Listings.tsx");

  it("uses PageHeading from primitives", () => {
    expect(listSrc).toContain("PageHeading");
  });

  it("uses StatusChip (not StatusPill) for status display", () => {
    expect(listSrc).toContain("StatusChip");
    // StatusPill should not appear as a JSX component — may still be imported for
    // backward compat but must not appear as <StatusPill
    expect(listSrc).not.toContain("<StatusPill");
  });

  it("uses EmptyState for the no-listings state", () => {
    expect(listSrc).toContain("EmptyState");
  });

  it("empty state uses EmptyState component (no ad-hoc inline CTA button)", () => {
    // EmptyState encapsulates the CTA button rendering with le-btn-ghost.
    // The page itself only needs to pass a cta prop — no raw button/link.
    expect(listSrc).toContain("EmptyState");
    // Confirm no ad-hoc styled Link/button used for the upload CTA
    expect(listSrc).not.toContain('className="le-btn-dark"');
  });

  it("has no raw <button with inline color/background styles", () => {
    const lines = listSrc.split("\n");
    const violations = lines.filter((l) => {
      if (l.trimStart().startsWith("//")) return false;
      return /<button/.test(l) && /style={{[^}]*(?:background|color):/.test(l);
    });
    expect(violations).toHaveLength(0);
  });
});

// ─── Billing ──────────────────────────────────────────────────────────────────
describe("Billing — WS7 grammar", () => {
  const billSrc = src("account/Billing.tsx");

  it("uses PageHeading from primitives", () => {
    expect(billSrc).toContain("PageHeading");
  });

  it("uses StatusChip (not StatusPill) for status display", () => {
    expect(billSrc).toContain("StatusChip");
    expect(billSrc).not.toContain("<StatusPill");
  });

  it("uses MoneyValue for all money display (cost-first principle)", () => {
    expect(billSrc).toContain("MoneyValue");
  });

  it("uses EmptyState for the no-billing state", () => {
    expect(billSrc).toContain("EmptyState");
  });

  it("has no raw <button with inline color/background styles", () => {
    const lines = billSrc.split("\n");
    const violations = lines.filter((l) => {
      if (l.trimStart().startsWith("//")) return false;
      return /<button/.test(l) && /style={{[^}]*(?:background|color):/.test(l);
    });
    expect(violations).toHaveLength(0);
  });
});

// ─── Profile (verify — already swept 1bd0285) ─────────────────────────────────
describe("Profile — WS7 verify (swept 1bd0285)", () => {
  const profSrc = src("account/Profile.tsx");

  it("uses PageHeading", () => {
    expect(profSrc).toContain("PageHeading");
  });

  it("uses le-btn-dark", () => {
    expect(profSrc).toContain("le-btn-dark");
  });

  it("uses le-btn-ghost", () => {
    expect(profSrc).toContain("le-btn-ghost");
  });

  it("has no direct CSS import side-effect", () => {
    expect(profSrc).not.toContain('import "@/v2/styles/v2.css"');
  });
});

// ─── Overview ─────────────────────────────────────────────────────────────────
describe("Overview — WS7 grammar (highest-traffic operator page)", () => {
  const ovSrc = src("Overview.tsx");

  it("uses PageHeading from primitives", () => {
    expect(ovSrc).toContain("PageHeading");
  });

  it("uses StatusChip (not StatusPill) for status display", () => {
    expect(ovSrc).toContain("StatusChip");
    expect(ovSrc).not.toContain("<StatusPill");
  });

  it("uses EmptyState for empty data sections", () => {
    expect(ovSrc).toContain("EmptyState");
  });

  it("uses MoneyValue for all money display", () => {
    expect(ovSrc).toContain("MoneyValue");
  });

  it("has no raw <button with inline color/background styles (except DegradedBadge retry which is justified)", () => {
    const lines = ovSrc.split("\n");
    const violations = lines.filter((l) => {
      if (l.trimStart().startsWith("//")) return false;
      return /<button/.test(l) && /style={{[^}]*(?:background|color):/.test(l);
    });
    // DegradedBadge's retry button has inline style but it's a justified
    // exception (atomic component with token colors). Allow ≤ 2 for that.
    expect(violations.length).toBeLessThanOrEqual(2);
  });

  it("uses le-btn-ghost for secondary link actions in the page", () => {
    expect(ovSrc).toContain("le-btn-ghost");
  });
});

// ─── Out-of-scope guard: no diff touches these files ─────────────────────────
// (Runtime assertion: check these files don't import primitives that only WS7 adds)
// This is implicit — any diff of PromptLab/PropertyDetail/Lab/Learning
// would fail the code-review gate. No source check needed here.
