/**
 * LoginDialog tests — "Immersive Login 5a" (commit 1755673a).
 *
 * One dialog, both flows, driven entirely by `useAuth()`:
 *   sign-in:  email -> choose (password | magic link) -> password | sent
 *   sign-up:  email -> verify (OTP) -> newpw -> welcome -> profile -> role -> source -> done
 *
 * `useAuth` is mocked as a `vi.fn()` factory so individual tests can
 * reconfigure `profile` / `session` and inspect call args on the auth
 * functions (`sendSignupCode`, `verifySignupCode`, `setPassword`,
 * `completeOnboarding`, etc).
 *
 * `SocialAuthButtons` is stubbed to a plain button pair — its real GSI
 * wiring is covered by the sibling `SocialAuthButtons.test.tsx`.
 *
 * `framer-motion` is stubbed so `AnimatePresence`/`motion.div` don't gate
 * step transitions behind real enter/exit animations — each step's DOM
 * swaps synchronously with React state, and the deliberate `setTimeout`
 * delays baked into the component (advance-after-verify, welcome->profile,
 * done->close) are awaited for real via `waitFor`.
 *
 * This file supersedes and consolidates the two pre-rewrite files
 * (`../LoginDialog.test.tsx` and this one), which asserted the old
 * single-form dialog and no longer match the component.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { LoginDialog } from "../LoginDialog";
import * as authLib from "@/lib/auth";

vi.mock("@/v2/components/auth/SocialAuthButtons", () => ({
  SocialAuthButtons: ({
    onGoogleSuccess,
    onGoogleError,
    disabled,
  }: {
    onGoogleSuccess: () => void;
    onGoogleError: (message: string) => void;
    disabled?: boolean;
  }) => (
    <div>
      <button type="button" disabled={disabled} onClick={onGoogleSuccess}>
        Continue with Google
      </button>
      <button
        type="button"
        onClick={() =>
          onGoogleError(
            "Google sign-in isn't available right now. Use email below for now.",
          )
        }
      >
        simulate-google-error
      </button>
    </div>
  ),
}));

// Stub framer-motion: keep AnimatePresence transparent, replace motion.div
// with a plain div so happy-dom doesn't choke on unknown DOM props and so
// step transitions (AnimatePresence mode="wait") resolve synchronously
// instead of waiting on a real exit/enter transition.
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
    useReducedMotion: () => true,
  };
});

function makeAuthMock(overrides: Record<string, unknown> = {}) {
  return {
    session: null,
    profile: null,
    signInWithMagicLink: vi.fn(() => Promise.resolve()),
    signInWithPassword: vi.fn(() => Promise.resolve()),
    sendSignupCode: vi.fn(() => Promise.resolve()),
    verifySignupCode: vi.fn(() => Promise.resolve()),
    setPassword: vi.fn(() => Promise.resolve()),
    completeOnboarding: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(() => makeAuthMock()),
}));

function setAuthMock(overrides: Record<string, unknown> = {}) {
  const mock = makeAuthMock(overrides);
  (authLib.useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mock);
  return mock;
}

function enterEmail(value: string) {
  fireEvent.change(screen.getByPlaceholderText("you@brokerage.com"), {
    target: { value },
  });
}

function clickContinue() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

async function goToSignupVerify(email = "ada@example.com") {
  fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
  enterEmail(email);
  clickContinue();
  await screen.findByText("Check your email");
}

function enterCode(digits: string) {
  const first = screen.getByLabelText("Verification code digit 1");
  fireEvent.change(first, { target: { value: digits } });
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  setAuthMock();
});

describe("LoginDialog — render / escape", () => {
  it("renders the email step when open", () => {
    render(<LoginDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Enter your email to continue.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("you@brokerage.com")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    const { container } = render(<LoginDialog open={false} onClose={vi.fn()} />);
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("Escape closes the dialog", () => {
    const onClose = vi.fn();
    render(<LoginDialog open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("LoginDialog — flow toggle", () => {
  it("toggles from sign-in to sign-up and back", () => {
    render(<LoginDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByText("Enter your email to continue.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByText("We'll just need your email to begin.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email to continue.")).toBeInTheDocument();
  });
});

describe("LoginDialog — email validation", () => {
  it("disables Continue until the email is a valid address", () => {
    render(<LoginDialog open={true} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("you@brokerage.com");
    const button = screen.getByRole("button", { name: "Continue" });

    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: "not-an-email" } });
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: "agent@example.com" } });
    expect(button).not.toBeDisabled();
  });
});

describe("LoginDialog — sign-in: choose step", () => {
  it("shows the choose step after a valid email on the sign-in flow", () => {
    render(<LoginDialog open={true} onClose={vi.fn()} />);
    enterEmail("agent@example.com");
    clickContinue();
    expect(screen.getByText("How would you like to sign in?")).toBeInTheDocument();
  });

  it("password path: calls signInWithPassword and closes the dialog", async () => {
    const onClose = vi.fn();
    const auth = setAuthMock();
    render(<LoginDialog open={true} onClose={onClose} />);

    enterEmail("agent@example.com");
    clickContinue();
    fireEvent.click(screen.getByText("Use my password"));
    expect(screen.getByText("Enter your password")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Enter your password"), {
      target: { value: "hunter22" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(auth.signInWithPassword).toHaveBeenCalledWith("agent@example.com", "hunter22"),
    );
    expect(await screen.findByText("You're in")).toBeInTheDocument();
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 1500 });
  });

  it("magic-link path: calls signInWithMagicLink and shows the sent step", async () => {
    const auth = setAuthMock();
    render(<LoginDialog open={true} onClose={vi.fn()} />);

    enterEmail("agent@example.com");
    clickContinue();
    fireEvent.click(screen.getByText("Email me a magic link"));

    await waitFor(() =>
      expect(auth.signInWithMagicLink).toHaveBeenCalledWith("agent@example.com"),
    );
    expect(await screen.findByText("Check your inbox")).toBeInTheDocument();
    expect(screen.getByText(/agent@example\.com/)).toBeInTheDocument();
  });
});

describe("LoginDialog — signup: verify (OTP)", () => {
  it("sends the signup code and shows the verify step", async () => {
    const auth = setAuthMock();
    render(<LoginDialog open={true} onClose={vi.fn()} />);

    await goToSignupVerify("ada@example.com");

    expect(auth.sendSignupCode).toHaveBeenCalledWith("ada@example.com");
    expect(screen.getAllByLabelText(/Verification code digit/)).toHaveLength(6);
  });

  it("auto-submits once 6 digits are entered and calls verifySignupCode", async () => {
    const auth = setAuthMock();
    render(<LoginDialog open={true} onClose={vi.fn()} />);

    await goToSignupVerify("ada@example.com");
    enterCode("123456");

    await waitFor(() =>
      expect(auth.verifySignupCode).toHaveBeenCalledWith("ada@example.com", "123456"),
    );
  });

  it("shows an error and resets the code on a wrong code", async () => {
    const auth = setAuthMock({
      verifySignupCode: vi.fn(() => Promise.reject(new Error("That code didn't work. Check it and try again."))),
    });
    render(<LoginDialog open={true} onClose={vi.fn()} />);

    await goToSignupVerify("ada@example.com");
    enterCode("000000");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code didn't work. Check it and try again.",
    );
    expect(screen.getByLabelText("Verification code digit 1")).toHaveValue("");
    expect(auth.completeOnboarding).not.toHaveBeenCalled();
  });
});

describe("LoginDialog — signup: new password gate", () => {
  async function toNewPw() {
    setAuthMock({ profile: null });
    render(<LoginDialog open={true} onClose={vi.fn()} />);
    await goToSignupVerify("ada@example.com");
    enterCode("123456");
    await screen.findByText("Create a password", {}, { timeout: 1500 });
  }

  it("gates Continue behind at least 8 characters", async () => {
    await toNewPw();
    const input = screen.getByPlaceholderText("Create a password");
    const button = screen.getByRole("button", { name: "Continue" });

    fireEvent.change(input, { target: { value: "short1!" } }); // 7 chars
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: "short12!" } }); // 8 chars
    expect(button).not.toBeDisabled();
  });

  it("reflects password strength in the meter label", async () => {
    await toNewPw();
    const input = screen.getByPlaceholderText("Create a password");

    fireEvent.change(input, { target: { value: "lowercase" } }); // length only
    expect(screen.getByText("Weak")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Password1" } }); // 3/4 criteria
    expect(screen.getByText("Medium")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Password123!" } }); // all 4 + length>=12
    expect(screen.getByText("Strong")).toBeInTheDocument();
  });

  it("calls setPassword and advances to welcome on Continue", async () => {
    const auth = setAuthMock({ profile: null });
    render(<LoginDialog open={true} onClose={vi.fn()} />);
    await goToSignupVerify("ada@example.com");
    enterCode("123456");
    await screen.findByText("Create a password", {}, { timeout: 1500 });

    fireEvent.change(screen.getByPlaceholderText("Create a password"), {
      target: { value: "Password123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(auth.setPassword).toHaveBeenCalledWith("Password123!"));
    expect(await screen.findByText("Welcome to Listing Elevate")).toBeInTheDocument();
  });
});

describe("LoginDialog — signup: full onboarding click-through", () => {
  it(
    "collects profile/persona/source and calls completeOnboarding, then shows done",
    async () => {
      const auth = setAuthMock({ profile: null });
      render(<LoginDialog open={true} onClose={vi.fn()} />);

      await goToSignupVerify("ada@example.com");
      enterCode("123456");
      await screen.findByText("Create a password", {}, { timeout: 1500 });

      fireEvent.change(screen.getByPlaceholderText("Create a password"), {
        target: { value: "Password123!" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      // welcome interstitial auto-advances to profile after 1.5s
      await screen.findByText("Tell us about you", {}, { timeout: 2500 });

      fireEvent.change(screen.getByPlaceholderText("Jordan"), { target: { value: "Ada" } });
      fireEvent.change(screen.getByPlaceholderText("Rivera"), { target: { value: "Lovelace" } });
      fireEvent.change(screen.getByPlaceholderText("Compass, Coldwell Banker…"), {
        target: { value: "Analytical Engines Realty" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      await screen.findByText("What best describes you?");
      fireEvent.click(screen.getByText("Agent"));
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));

      await screen.findByText("How did you hear about us?");
      fireEvent.click(screen.getByRole("radio", { name: "A search engine" }));
      fireEvent.click(screen.getByRole("button", { name: "Google" }));
      fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));

      await waitFor(() =>
        expect(auth.completeOnboarding).toHaveBeenCalledWith({
          firstName: "Ada",
          lastName: "Lovelace",
          brokerage: "Analytical Engines Realty",
          persona: "agent",
          signupSource: "search",
          signupSourceDetail: "Google",
        }),
      );
      expect(await screen.findByText("You're all set, Ada")).toBeInTheDocument();
    },
    8000,
  );
});

describe("LoginDialog — existing-account short-circuit", () => {
  it("skips onboarding and goes straight to done when profile.first_name is already present", async () => {
    const auth = setAuthMock({ profile: { first_name: "Ada" } });
    render(<LoginDialog open={true} onClose={vi.fn()} />);

    await goToSignupVerify("ada@example.com");
    enterCode("123456");

    expect(await screen.findByText("You're in", {}, { timeout: 1500 })).toBeInTheDocument();
    expect(screen.queryByText("Create a password")).not.toBeInTheDocument();
    expect(screen.queryByText("Tell us about you")).not.toBeInTheDocument();
    expect(auth.completeOnboarding).not.toHaveBeenCalled();
  });
});
