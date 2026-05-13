import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { SidebarItem } from "../SidebarItem";

const withRouter = (ui: React.ReactNode, path = "/dashboard") => (
  <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
);

describe("SidebarItem", () => {
  it("renders label and icon when expanded", () => {
    render(
      withRouter(
        <SidebarItem to="/dashboard" label="Overview" icon={LayoutGrid} collapsed={false} />,
      ),
    );
    expect(screen.getByText("Overview")).toBeTruthy();
  });

  it("hides label when collapsed", () => {
    render(
      withRouter(
        <SidebarItem to="/dashboard" label="Overview" icon={LayoutGrid} collapsed={true} />,
      ),
    );
    expect(screen.queryByText("Overview")).toBeNull();
  });

  it("marks active when the current path matches", () => {
    render(
      withRouter(
        <SidebarItem to="/dashboard" label="Overview" icon={LayoutGrid} collapsed={false} end />,
        "/dashboard",
      ),
    );
    const link = screen.getByRole("link", { name: /Overview/i });
    expect(link.getAttribute("aria-current")).toBe("page");
  });
});
