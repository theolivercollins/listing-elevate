/**
 * Tests for the shared-kit primitives: StatusChip, EmptyState, MoneyValue.
 * Written TDD — tests authored before implementation.
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusChip } from "../primitives";
import { EmptyState } from "../primitives";
import { MoneyValue } from "../primitives";

// ── StatusChip ────────────────────────────────────────────────────────────────

describe("StatusChip", () => {
  it("renders the correct user-facing label for 'complete'", () => {
    render(<StatusChip status="complete" />);
    expect(screen.getByText("Delivered")).toBeDefined();
  });

  it("renders the correct label for 'needs_review'", () => {
    render(<StatusChip status="needs_review" />);
    expect(screen.getByText("Needs attention")).toBeDefined();
  });

  it("renders the correct label for 'queued'", () => {
    render(<StatusChip status="queued" />);
    expect(screen.getByText("Received")).toBeDefined();
  });

  it("renders the correct label for 'generating'", () => {
    render(<StatusChip status="generating" />);
    expect(screen.getByText("Rendering")).toBeDefined();
  });

  it("renders the correct label for 'qc_soft_reject'", () => {
    render(<StatusChip status="qc_soft_reject" />);
    expect(screen.getByText("Needs attention")).toBeDefined();
  });

  it("renders a chip element with a color style", () => {
    const { container } = render(<StatusChip status="complete" />);
    // Should have at least one element with a data-status attribute
    const chip = container.querySelector("[data-status]");
    expect(chip).toBeTruthy();
    expect(chip?.getAttribute("data-status")).toBe("complete");
  });
});

// ── EmptyState ────────────────────────────────────────────────────────────────

describe("EmptyState", () => {
  it("renders the message text", () => {
    render(<EmptyState message="No listings yet." />);
    expect(screen.getByText("No listings yet.")).toBeDefined();
  });

  it("renders an optional CTA button when provided", () => {
    render(
      <EmptyState
        message="No cost events."
        cta={{ label: "Add one", onClick: () => {} }}
      />
    );
    expect(screen.getByRole("button", { name: "Add one" })).toBeDefined();
  });

  it("does not render a CTA button when none is provided", () => {
    render(<EmptyState message="Empty." />);
    const btns = screen.queryAllByRole("button");
    expect(btns.length).toBe(0);
  });

  it("renders an icon container by default", () => {
    const { container } = render(<EmptyState message="No data." />);
    const iconEl = container.querySelector("[data-empty-icon]");
    expect(iconEl).toBeTruthy();
  });
});

// ── MoneyValue ────────────────────────────────────────────────────────────────

describe("MoneyValue", () => {
  it("renders '—' for null cents", () => {
    render(<MoneyValue cents={null} />);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders '—' for undefined cents", () => {
    render(<MoneyValue cents={undefined} />);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("does NOT render '$0.00' or '$0' for null input", () => {
    const { container } = render(<MoneyValue cents={null} />);
    expect(container.textContent).not.toContain("$0");
  });

  it("renders correct dollars for a cents value (100 → $1)", () => {
    render(<MoneyValue cents={100} />);
    expect(screen.getByText("$1")).toBeDefined();
  });

  it("renders correct dollars for a larger cents value (12345 → $123)", () => {
    render(<MoneyValue cents={12345} />);
    // 12345 cents = $123.45, formatted as $123 (no decimals in default format)
    expect(screen.getByText("$123")).toBeDefined();
  });

  it("renders zero cents as '$0' when explicitly 0 (not null/undefined)", () => {
    render(<MoneyValue cents={0} />);
    expect(screen.getByText("$0")).toBeDefined();
  });

  it("applies a tooltip attribute when value is absent", () => {
    const { container } = render(<MoneyValue cents={null} tooltipWhenAbsent="No cost data yet" />);
    const el = container.querySelector("[title]");
    expect(el).toBeTruthy();
    expect(el?.getAttribute("title")).toBe("No cost data yet");
  });
});
