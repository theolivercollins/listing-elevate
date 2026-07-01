/**
 * LoginDialog tests (2026-07-01 login revamp) — sign-up flow, weak-password
 * validation, and graceful OAuth-error surfacing.
 *
 * Baseline smoke coverage (open/closed render, escape-to-close, deferred
 * focus) and the social-button / magic-link / password sign-in paths live in
 * the sibling `../LoginDialog.test.tsx` file — kept here to a minimum to
 * avoid duplicating every case in both places.
 *
 * The mocked `useAuth` is a `vi.fn()` factory (not a plain object literal) so
 * individual tests can reconfigure it via `authLib.useAuth as any` — needed
 * for the OAuth-error test, which must make `signInWithGoogle` reject only
 * for that one case.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { LoginDialog } from "../LoginDialog";
import * as authLib from "@/lib/auth";

// Stub framer-motion: keep AnimatePresence transparent, replace motion.div
// with a plain div so jsdom doesn't error on unknown DOM props and so the
// form/sent/confirm step swap (AnimatePresence mode="wait") resolves
// synchronously instead of waiting on a real exit/enter transition.
vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MotionDiv = React.forwardRef<HTMLDivElement, any>(
    (
      {
        children,
        initial: _i, animate: _a, exit: _e, transition: _t,
        variants: _v, layout: _l, layoutId: _li, whileHover: _wh,
        whileInView: _wi, viewport: _vp,
        ...rest
      },
      ref,
    ) => <div ref={ref} {...rest}>{children}</div>,
  );
  MotionDiv.displayName = "MotionDiv";
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    motion: { ...actual.motion, div: MotionDiv },
  };
});

function makeAuthMock(overrides: Record<string, unknown> = {}) {
  return {
    adminVerified: true,
    sendAdminEmailCode: vi.fn(),
    verifyAdminEmailCode: vi.fn(),
    signInWithMagicLink: vi.fn(() => Promise.resolve()),
    signInWithPassword: vi.fn(() => Promise.resolve()),
    signInWithGoogle: vi.fn(() => Promise.resolve()),
    signInWithMicrosoft: vi.fn(() => Promise.resolve()),
    signUp: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(() => makeAuthMock()),
}));

describe("LoginDialog — baseline render / escape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (authLib.useAuth as any).mockReturnValue(makeAuthMock());
  });

  it("renders when open is true", () => {
    render(<LoginDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    const { container } = render(<LoginDialog open={false} onClose={vi.fn()} />);
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("closes dialog on escape key", () => {
    const mockOnClose = vi.fn();
    render(<LoginDialog open={true} onClose={mockOnClose} />);

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("defers email input focus until after animation (300ms)", async () => {
    render(<LoginDialog open={true} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText("you@brokerage.com");
    expect(document.activeElement).not.toBe(input);

    await waitFor(
      () => {
        expect(input).toHaveFocus();
      },
      { timeout: 400 },
    );
  });
});

describe("LoginDialog — sign-up flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (authLib.useAuth as any).mockReturnValue(makeAuthMock());
  });

  function switchToSignUp() {
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
  }

  it("switching to sign-up shows the sign-up heading and fields", () => {
    render(<LoginDialog open={true} onClose={vi.fn()} />);
    switchToSignUp();

    expect(
      screen.getByRole("heading", { name: "Create your account." }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Jane")).toHaveAttribute(
      "id",
      "signup-first-name",
    );
    expect(screen.getByPlaceholderText("Doe")).toHaveAttribute(
      "id",
      "signup-last-name",
    );
    expect(screen.getByPlaceholderText("Acme Realty")).toHaveAttribute(
      "id",
      "signup-brokerage",
    );
    expect(screen.getByPlaceholderText("At least 10 characters")).toHaveAttribute(
      "id",
      "signup-password",
    );
  });

  it("switching back via 'Sign in' returns to the sign-in heading", () => {
    render(<LoginDialog open={true} onClose={vi.fn()} />);
    switchToSignUp();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      screen.getByRole("heading", { name: "Welcome back." }),
    ).toBeInTheDocument();
  });

  it("submits a valid sign-up and calls signUp with email, password, and meta", async () => {
    const authMock = makeAuthMock();
    (authLib.useAuth as any).mockReturnValue(authMock);

    render(<LoginDialog open={true} onClose={vi.fn()} />);
    switchToSignUp();

    fireEvent.change(screen.getByPlaceholderText("Jane"), {
      target: { value: "Ada" },
    });
    fireEvent.change(screen.getByPlaceholderText("Doe"), {
      target: { value: "Lovelace" },
    });
    fireEvent.change(screen.getByPlaceholderText("Acme Realty"), {
      target: { value: "Analytical Engines Realty" },
    });
    fireEvent.change(screen.getByPlaceholderText("you@brokerage.com"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("At least 10 characters"), {
      target: { value: "Password123!" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() =>
      expect(authMock.signUp).toHaveBeenCalledWith(
        "ada@example.com",
        "Password123!",
        expect.objectContaining({
          first_name: "Ada",
          last_name: "Lovelace",
          brokerage: "Analytical Engines Realty",
        }),
      ),
    );

    expect(
      await screen.findByRole("heading", { name: "Confirm your email." }),
    ).toBeInTheDocument();
  });

  it("trims leading/trailing whitespace from the email before calling signUp", async () => {
    const authMock = makeAuthMock();
    (authLib.useAuth as any).mockReturnValue(authMock);

    render(<LoginDialog open={true} onClose={vi.fn()} />);
    switchToSignUp();

    fireEvent.change(screen.getByPlaceholderText("you@brokerage.com"), {
      target: { value: "  ada@example.com  " },
    });
    fireEvent.change(screen.getByPlaceholderText("At least 10 characters"), {
      target: { value: "Password123!" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() =>
      expect(authMock.signUp).toHaveBeenCalledWith(
        "ada@example.com",
        "Password123!",
        expect.any(Object),
      ),
    );
  });

  it("rejects a weak password without calling signUp", async () => {
    const authMock = makeAuthMock();
    (authLib.useAuth as any).mockReturnValue(authMock);

    render(<LoginDialog open={true} onClose={vi.fn()} />);
    switchToSignUp();

    fireEvent.change(screen.getByPlaceholderText("you@brokerage.com"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("At least 10 characters"), {
      target: { value: "short" },
    });

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(
      await screen.findByText("Password must be at least 10 characters"),
    ).toBeInTheDocument();
    expect(authMock.signUp).not.toHaveBeenCalled();
  });
});

describe("LoginDialog — OAuth error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a friendly message and stays mounted when signInWithGoogle rejects", async () => {
    const authMock = makeAuthMock({
      signInWithGoogle: vi.fn(() => Promise.reject(new Error("provider not configured"))),
    });
    (authLib.useAuth as any).mockReturnValue(authMock);

    render(<LoginDialog open={true} onClose={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(
      "Google sign-in isn't set up yet. Use email below for now.",
    );

    // Dialog must still be mounted — no crash/unmount on OAuth failure.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
