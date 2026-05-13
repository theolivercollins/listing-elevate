import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCard } from "../KpiCard";

describe("KpiCard", () => {
  it("renders label and value", () => {
    render(<KpiCard label="Active customers" value="142" gradient="blue" />);
    expect(screen.getByText("Active customers")).toBeTruthy();
    expect(screen.getByText("142")).toBeTruthy();
  });

  it("renders a positive delta with '+' prefix", () => {
    render(<KpiCard label="Revenue" value="$12.4k" gradient="navy" delta={15.2} />);
    expect(screen.getByText(/\+15\.2%/)).toBeTruthy();
  });

  it("renders a negative delta without doubled '-' prefix", () => {
    render(<KpiCard label="Spend" value="$8.1k" gradient="beige" delta={-3.4} deltaIsGoodWhenNegative />);
    expect(screen.getByText(/-3\.4%/)).toBeTruthy();
  });
});
