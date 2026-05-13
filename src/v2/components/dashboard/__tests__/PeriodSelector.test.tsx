import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PeriodSelector } from "../PeriodSelector";

describe("PeriodSelector", () => {
  it("renders the three options", () => {
    render(<PeriodSelector value="30d" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^7D$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^30D$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^90D$/i })).toBeTruthy();
  });

  it("marks the active option with aria-pressed=true", () => {
    render(<PeriodSelector value="7d" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^7D$/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^30D$/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("fires onChange with the new period when clicked", () => {
    const onChange = vi.fn();
    render(<PeriodSelector value="30d" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^7D$/i }));
    expect(onChange).toHaveBeenCalledWith("7d");
  });
});
