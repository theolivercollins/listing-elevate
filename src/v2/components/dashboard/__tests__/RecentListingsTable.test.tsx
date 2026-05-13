import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RecentListingsTable } from "../RecentListingsTable";

const SAMPLE = [
  {
    id: "p-1",
    order_id: "V1-00001",
    address: "123 Main St, Punta Gorda FL",
    customer_id: "u-1",
    customer_email: "agent@example.com",
    status: "complete",
    cost_cents: 12350,
    created_at: "2026-05-13T12:00:00Z",
    thumbnail_url: null,
  },
];

describe("RecentListingsTable", () => {
  it("renders rows with order id, customer, and cost", () => {
    render(
      <MemoryRouter>
        <RecentListingsTable listings={SAMPLE} loading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("V1-00001")).toBeTruthy();
    expect(screen.getByText("agent@example.com")).toBeTruthy();
    expect(screen.getByText(/\$123\.50/)).toBeTruthy();
  });

  it("renders empty state when no listings", () => {
    render(
      <MemoryRouter>
        <RecentListingsTable listings={[]} loading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/no recent listings/i)).toBeTruthy();
  });
});
