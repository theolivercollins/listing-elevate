import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Landing from "./Landing";

describe("Landing page", () => {
  it("renders the root landing shell", () => {
    render(
      <MemoryRouter initialEntries={["/v2"]}>
        <Landing />
      </MemoryRouter>
    );
    expect(screen.getByTestId("v2-landing-root")).toBeTruthy();
  });
});
