/**
 * money-value-callsites tests — TDD written before implementation.
 *
 * Covers the success criterion for task WS1a-moneyvalue-callsites:
 *   MV1. MoneyValue renders "—" for null
 *   MV2. MoneyValue renders "—" for undefined
 *   MV3. MoneyValue renders "—" for NaN (treated as null/absent)
 *   MV4. MoneyValue renders "$0" for 0 (explicit zero IS a real value)
 *   MV5. MoneyValue renders formatted dollar string for positive cents
 *   MV6. fmtMoney returns "—" for null
 *   MV7. fmtMoney returns "—" for undefined
 *   MV8. fmtMoney returns "$0" for 0
 *   MV9. fmtMoney returns formatted dollar string for positive cents
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MoneyValue, fmtMoney } from "@/components/dashboard/primitives";

describe("MoneyValue component", () => {
  it("MV1: renders '—' for null", () => {
    render(<MoneyValue cents={null} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("MV2: renders '—' for undefined", () => {
    render(<MoneyValue cents={undefined} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("MV3: renders '—' for NaN (treated as absent)", () => {
    render(<MoneyValue cents={NaN} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("MV4: renders '$0' for 0 cents", () => {
    render(<MoneyValue cents={0} />);
    expect(screen.getByText("$0")).toBeTruthy();
  });

  it("MV5: renders formatted dollar string for positive cents", () => {
    render(<MoneyValue cents={4999} />);
    expect(screen.getByText("$50")).toBeTruthy();
  });
});

describe("fmtMoney string formatter", () => {
  it("MV6: returns '—' for null", () => {
    expect(fmtMoney(null)).toBe("—");
  });

  it("MV7: returns '—' for undefined", () => {
    expect(fmtMoney(undefined)).toBe("—");
  });

  it("MV8: returns '$0' for 0", () => {
    expect(fmtMoney(0)).toBe("$0");
  });

  it("MV9: returns formatted dollar string for positive cents", () => {
    expect(fmtMoney(25000)).toBe("$250");
  });

  it("MV10: returns '—' for NaN", () => {
    expect(fmtMoney(NaN)).toBe("—");
  });
});
