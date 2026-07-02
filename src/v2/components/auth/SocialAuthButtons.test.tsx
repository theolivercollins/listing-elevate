/**
 * SocialAuthButtons — the Google Identity Services (GSI) button wrapper.
 *
 * `@/lib/googleIdentity`'s `initGoogleIdentity` is mocked here (its own
 * nonce/initialize/signInWithIdToken behavior is covered by
 * `src/lib/__tests__/googleIdentity.test.ts`); this file only verifies
 * SocialAuthButtons' OWN wiring: it calls `initGoogleIdentity`, renders the
 * button into its container on success, forwards the reported
 * success/error outcomes to its own props, degrades gracefully when GSI
 * never initializes, and tears down on unmount.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SocialAuthButtons } from "./SocialAuthButtons";
import { initGoogleIdentity } from "@/lib/googleIdentity";

vi.mock("@/lib/googleIdentity", () => ({
  initGoogleIdentity: vi.fn(),
}));

const mockInitGoogleIdentity = initGoogleIdentity as ReturnType<typeof vi.fn>;

describe("SocialAuthButtons", () => {
  let renderButtonMock: ReturnType<typeof vi.fn>;
  let cancelMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    renderButtonMock = vi.fn();
    cancelMock = vi.fn();
    (globalThis as unknown as { google: unknown }).google = {
      accounts: { id: { renderButton: renderButtonMock, cancel: cancelMock } },
    };
  });

  afterEach(() => {
    delete (globalThis as { google?: unknown }).google;
  });

  it("calls initGoogleIdentity on mount and renders the button into its container once GSI initializes", async () => {
    mockInitGoogleIdentity.mockResolvedValue(undefined);

    render(<SocialAuthButtons onGoogleSuccess={vi.fn()} onGoogleError={vi.fn()} />);

    expect(mockInitGoogleIdentity).toHaveBeenCalledTimes(1);
    const args = mockInitGoogleIdentity.mock.calls[0][0];
    expect(typeof args.onSuccess).toBe("function");
    expect(typeof args.onError).toBe("function");

    await waitFor(() => expect(renderButtonMock).toHaveBeenCalledTimes(1));
    const [container, options] = renderButtonMock.mock.calls[0];
    expect(container).toBe(screen.getByTestId("google-signin-button"));
    expect(options).toMatchObject({ theme: "outline", text: "continue_with" });
  });

  it("forwards a successful credential exchange to onGoogleSuccess", async () => {
    const onGoogleSuccess = vi.fn();
    mockInitGoogleIdentity.mockImplementation(({ onSuccess }) => {
      onSuccess();
      return Promise.resolve();
    });

    render(<SocialAuthButtons onGoogleSuccess={onGoogleSuccess} onGoogleError={vi.fn()} />);

    await waitFor(() => expect(onGoogleSuccess).toHaveBeenCalledTimes(1));
  });

  it("forwards a credential-exchange error to onGoogleError", async () => {
    const onGoogleError = vi.fn();
    mockInitGoogleIdentity.mockImplementation(({ onError }) => {
      onError("Google sign-in failed. Use email below for now.");
      return Promise.resolve();
    });

    render(<SocialAuthButtons onGoogleSuccess={vi.fn()} onGoogleError={onGoogleError} />);

    await waitFor(() =>
      expect(onGoogleError).toHaveBeenCalledWith(
        "Google sign-in failed. Use email below for now.",
      ),
    );
  });

  it("degrades gracefully when GSI fails to load/init: hides the button container and shows a fallback message", async () => {
    mockInitGoogleIdentity.mockRejectedValue(new Error("Failed to load script"));

    render(<SocialAuthButtons onGoogleSuccess={vi.fn()} onGoogleError={vi.fn()} />);

    expect(
      await screen.findByText(/Google sign-in unavailable/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("google-signin-button")).toHaveStyle({ display: "none" });
    expect(renderButtonMock).not.toHaveBeenCalled();
  });

  it("dims and disables pointer events on the container when disabled", async () => {
    mockInitGoogleIdentity.mockResolvedValue(undefined);

    render(
      <SocialAuthButtons onGoogleSuccess={vi.fn()} onGoogleError={vi.fn()} disabled />,
    );

    await waitFor(() => expect(renderButtonMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("google-signin-button")).toHaveStyle({
      opacity: "0.5",
      pointerEvents: "none",
    });
  });

  it("cancels any active GSI prompt on unmount", async () => {
    mockInitGoogleIdentity.mockResolvedValue(undefined);

    const { unmount } = render(
      <SocialAuthButtons onGoogleSuccess={vi.fn()} onGoogleError={vi.fn()} />,
    );
    await waitFor(() => expect(renderButtonMock).toHaveBeenCalledTimes(1));

    unmount();

    expect(cancelMock).toHaveBeenCalledTimes(1);
  });
});
