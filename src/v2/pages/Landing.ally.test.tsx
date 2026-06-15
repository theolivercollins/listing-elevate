import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Landing from "./Landing";

const originalFlag = import.meta.env.VITE_HOMEPAGE_ALLY_ENABLED;

afterEach(() => {
  import.meta.env.VITE_HOMEPAGE_ALLY_ENABLED = originalFlag;
});

describe("Landing - Ally public chatbot", () => {
  it("does not mount Ally unless the homepage flag is exactly true", () => {
    import.meta.env.VITE_HOMEPAGE_ALLY_ENABLED = "false";

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Landing />
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText("Open chat with Ally")).toBeNull();
  });

  it("mounts Ally on the marketing landing when the homepage flag is true", () => {
    import.meta.env.VITE_HOMEPAGE_ALLY_ENABLED = "true";

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Landing />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Open chat with Ally")).toBeTruthy();
  });
});
