/**
 * LoginDialog tests — unified sign-in / sign-up modal (2026-07-01 login revamp).
 *
 * This file covers:
 *   1. Animation-stability basics carried over from the 2026-06-11 fix: deferred
 *      focus marker present (no raw autofocus), dialog mount/unmount by `open`,
 *      Escape closes, deferred focus actually lands.
 *   2. Social auth buttons render (Google only — Microsoft/Azure is disabled
 *      pending a future Entra tenant) and delegate to signInWithGoogle from
 *      useAuth.
 *   3. The default sign-in path (magic link) and the password-toggle path.
 *
 * Sign-up / weak-password / OAuth-error-surfacing coverage lives in the sibling
 * `__tests__/LoginDialog.test.tsx` file — split to avoid duplicating every case
 * in both places.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as React from "react";
import { LoginDialog } from "./LoginDialog";

// Mutable auth mock — individual tests can inspect call args via these fns.
const authMock = {
  adminVerified: true,
  sendAdminEmailCode: vi.fn(),
  verifyAdminEmailCode: vi.fn(),
  signInWithMagicLink: vi.fn(() => Promise.resolve()),
  signInWithPassword: vi.fn(() => Promise.resolve()),
  signInWithGoogle: vi.fn(() => Promise.resolve()),
  signUp: vi.fn(() => Promise.resolve()),
};

vi.mock("@/lib/auth", () => ({
  useAuth: () => authMock,
}));

// Stub framer-motion: keep AnimatePresence transparent, replace motion.div
// with a plain div so jsdom doesn't error on unknown DOM props.
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

function renderDialog(open = true, onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <LoginDialog open={open} onClose={onClose} />
    </MemoryRouter>,
  );
}

describe("LoginDialog — animation stability", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    authMock.signInWithMagicLink.mockImplementation(() => Promise.resolve());
    authMock.signInWithPassword.mockImplementation(() => Promise.resolve());
    authMock.signInWithGoogle.mockImplementation(() => Promise.resolve());
    authMock.signUp.mockImplementation(() => Promise.resolve());
  });

  it("1. email input carries data-autofocus-deferred (deferred-focus marker present, raw autofocus absent)", () => {
    renderDialog();
    const emailInput = screen.getByPlaceholderText("you@brokerage.com");
    // The fix: instead of autoFocus, we mark the input with data-autofocus-deferred
    // and call .focus() in a useEffect after the entry animation completes.
    expect(emailInput).toHaveAttribute("data-autofocus-deferred", "true");
    // Confirm the raw autofocus attribute is absent (would trigger browser scroll).
    expect(emailInput).not.toHaveAttribute("autofocus");
  });

  it("2. dialog is not rendered when open=false", () => {
    renderDialog(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("3. dialog has accessible role when open=true", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("4. Escape closes the dialog", () => {
    const onClose = vi.fn();
    renderDialog(true, onClose);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("5. deferred focus lands on the email input within ~400ms", async () => {
    renderDialog();
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

describe("LoginDialog — social auth buttons", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    authMock.signInWithGoogle.mockImplementation(() => Promise.resolve());
  });

  it("renders 'Continue with Google' and does NOT render a Microsoft button", () => {
    renderDialog();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue with Microsoft" }),
    ).not.toBeInTheDocument();
  });

  it("clicking 'Continue with Google' calls signInWithGoogle", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(authMock.signInWithGoogle).toHaveBeenCalledTimes(1));
  });
});

describe("LoginDialog — sign-in: magic link (default) path", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    authMock.signInWithMagicLink.mockImplementation(() => Promise.resolve());
  });

  it("submits the email and calls signInWithMagicLink, then shows the sent step", async () => {
    renderDialog();

    const emailInput = screen.getByPlaceholderText("you@brokerage.com");
    fireEvent.change(emailInput, { target: { value: "agent@example.com" } });

    fireEvent.click(screen.getByRole("button", { name: /send magic link/i }));

    await waitFor(() =>
      expect(authMock.signInWithMagicLink).toHaveBeenCalledWith(
        "agent@example.com",
      ),
    );

    expect(
      await screen.findByRole("heading", { name: "Check your inbox." }),
    ).toBeInTheDocument();
  });

  it("trims leading/trailing whitespace from the email before calling signInWithMagicLink", async () => {
    renderDialog();

    const emailInput = screen.getByPlaceholderText("you@brokerage.com");
    fireEvent.change(emailInput, {
      target: { value: "  agent@example.com  " },
    });

    fireEvent.click(screen.getByRole("button", { name: /send magic link/i }));

    await waitFor(() =>
      expect(authMock.signInWithMagicLink).toHaveBeenCalledWith(
        "agent@example.com",
      ),
    );
  });
});

describe("LoginDialog — focus trap & restore", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("restores focus to the previously-focused element on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open login";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <MemoryRouter>
        <LoginDialog open={true} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    // Simulate the user having moved focus into the dialog (e.g. via the
    // deferred-focus effect, or a manual Tab) before closing it.
    const closeButton = screen.getByRole("button", { name: "Close sign in" });
    closeButton.focus();
    expect(document.activeElement).toBe(closeButton);

    rerender(
      <MemoryRouter>
        <LoginDialog open={false} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    expect(document.activeElement).toBe(trigger);

    document.body.removeChild(trigger);
  });

  it("Tab from the last focusable element wraps to the first (close button)", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    const closeButton = screen.getByRole("button", { name: "Close sign in" });
    const createAccountButton = screen.getByRole("button", {
      name: "Create an account",
    });

    createAccountButton.focus();
    expect(document.activeElement).toBe(createAccountButton);

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);
  });

  it("Shift+Tab from the first focusable element (close button) wraps to the last", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    const closeButton = screen.getByRole("button", { name: "Close sign in" });
    const createAccountButton = screen.getByRole("button", {
      name: "Create an account",
    });

    closeButton.focus();
    expect(document.activeElement).toBe(closeButton);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(createAccountButton);
  });
});

describe("LoginDialog — state reset on reopen", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    authMock.signInWithMagicLink.mockImplementation(() => Promise.resolve());
  });

  it("clears a previously-typed password on next open after a close", () => {
    const { rerender } = renderDialog(true);

    fireEvent.click(screen.getByText("Use a password instead"));
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "hunter2" },
    });

    rerender(
      <MemoryRouter>
        <LoginDialog open={false} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <LoginDialog open={true} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    // usePassword is reset to false on reopen too — toggle it back on to
    // inspect the (now-cleared) password field.
    fireEvent.click(screen.getByText("Use a password instead"));
    expect(screen.getByPlaceholderText("••••••••")).toHaveValue("");
  });

  it("does not clear an active 'sent' success screen while open stays continuously true", async () => {
    const { rerender } = renderDialog(true);

    fireEvent.change(screen.getByPlaceholderText("you@brokerage.com"), {
      target: { value: "agent@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send magic link/i }));

    expect(
      await screen.findByRole("heading", { name: "Check your inbox." }),
    ).toBeInTheDocument();

    // Parent re-renders with `open` still true (e.g. an unrelated state
    // change one level up) — the reset effect's dependency array is `[open]`
    // only, so it must not re-fire and stomp the still-showing sent screen.
    rerender(
      <MemoryRouter>
        <LoginDialog open={true} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Check your inbox." }),
    ).toBeInTheDocument();
  });
});

describe("LoginDialog — sign-in: password path", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    authMock.signInWithPassword.mockImplementation(() => Promise.resolve());
  });

  it("toggling 'Use a password instead' reveals the password field", () => {
    renderDialog();
    expect(screen.queryByPlaceholderText("••••••••")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Use a password instead"));

    expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "id",
      "login-password",
    );
    // Toggle label flips once the password field is revealed.
    expect(
      screen.getByText("Email me a magic link instead"),
    ).toBeInTheDocument();
  });

  it("submits email + password and calls signInWithPassword", async () => {
    const onClose = vi.fn();
    renderDialog(true, onClose);

    fireEvent.click(screen.getByText("Use a password instead"));

    fireEvent.change(screen.getByPlaceholderText("you@brokerage.com"), {
      target: { value: "agent@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "correct-horse-battery" },
    });

    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() =>
      expect(authMock.signInWithPassword).toHaveBeenCalledWith(
        "agent@example.com",
        "correct-horse-battery",
      ),
    );
  });
});
