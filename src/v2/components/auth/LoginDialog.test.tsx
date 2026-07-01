/**
 * LoginDialog animation-stability tests (2026-06-11).
 *
 * Key assertions:
 *   1. The email input has data-autofocus-deferred="true" (our deferred-focus
 *      marker) — confirming the fix is in place. The raw `autoFocus` attribute
 *      must be absent so the browser doesn't scroll/shift layout while the
 *      framer-motion y-translate entry animation (280ms) is still running.
 *   2. password field is present in the default (password) mode.
 *   3. dialog is not rendered when open=false.
 *   4. dialog renders with accessible role when open=true.
 *   5. switching to magic-link mode removes the password field cleanly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as React from "react";
import { LoginDialog } from "./LoginDialog";

// Stub the auth hook — we only need the shape, not real Supabase calls.
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminVerified: true,
    sendAdminEmailCode: vi.fn(),
    verifyAdminEmailCode: vi.fn(),
    signInWithMagicLink: vi.fn(),
    signInWithPassword: vi.fn(),
  }),
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

function renderDialog(open = true) {
  return render(
    <MemoryRouter>
      <LoginDialog open={open} onClose={() => {}} />
    </MemoryRouter>,
  );
}

describe("LoginDialog — animation stability", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
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

  it("2. password field is present in the default (password) mode", () => {
    renderDialog();
    expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();
  });

  it("3. dialog is not rendered when open=false", () => {
    renderDialog(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("4. dialog has accessible role when open=true", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("5. toggling to magic-link mode removes the password field", () => {
    renderDialog();
    const toggleBtn = screen.getByText(/email me a magic link instead/i);
    act(() => toggleBtn.click());
    expect(screen.queryByPlaceholderText("••••••••")).not.toBeInTheDocument();
  });
});
