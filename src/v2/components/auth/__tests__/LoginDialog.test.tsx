import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoginDialog } from "../LoginDialog";
import * as authLib from "@/lib/auth";

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(() => ({
    signInWithPassword: vi.fn(),
    signInWithMagicLink: vi.fn(),
  })),
}));

describe("LoginDialog animation fixes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders when open is true", () => {
    render(<LoginDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    const { container } = render(<LoginDialog open={false} onClose={vi.fn()} />);
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("defers email input focus until after animation (300ms)", async () => {
    const mockOnClose = vi.fn();
    const emailInput = vi.fn();
    render(<LoginDialog open={true} onClose={mockOnClose} />);

    const input = screen.getByPlaceholderText("you@brokerage.com");
    expect(document.activeElement).not.toBe(input);

    await waitFor(
      () => {
        expect(input).toHaveFocus();
      },
      { timeout: 400 },
    );
  });

  it("switches mode from password to magic smoothly", async () => {
    render(<LoginDialog open={true} onClose={vi.fn()} />);

    const modeToggle = screen.getByText("Email me a magic link instead");
    fireEvent.click(modeToggle);

    await waitFor(() => {
      expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    });
  });


  it("password field animates in when mode is 'password'", async () => {
    render(<LoginDialog open={true} onClose={vi.fn()} />);

    // Initially password should be visible
    expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();

    // Switch to magic mode
    const modeToggle = screen.getByText("Email me a magic link instead");
    fireEvent.click(modeToggle);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("••••••••")).not.toBeInTheDocument();
    });

    // Switch back to password mode
    const backToggle = screen.getByText("Sign in with password instead");
    fireEvent.click(backToggle);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();
    });
  });

  it("closes dialog on escape key", () => {
    const mockOnClose = vi.fn();
    render(<LoginDialog open={true} onClose={mockOnClose} />);

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("hides password field when switching to magic mode", async () => {
    render(<LoginDialog open={true} onClose={vi.fn()} />);

    expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();

    const modeToggle = screen.getByText("Email me a magic link instead");
    fireEvent.click(modeToggle);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("••••••••")).not.toBeInTheDocument();
    });
  });

  it("shows password field when switching back to password mode", async () => {
    render(<LoginDialog open={true} onClose={vi.fn()} />);

    const modeToggle = screen.getByText("Email me a magic link instead");
    fireEvent.click(modeToggle);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("••••••••")).not.toBeInTheDocument();
    });

    const backToggle = screen.getByText("Sign in with password instead");
    fireEvent.click(backToggle);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();
    });
  });
});
