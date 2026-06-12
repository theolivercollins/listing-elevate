/**
 * Navigation link tests — TDD, written before implementation.
 *
 * Covers:
 * C1. Status.tsx "View all videos" link targets /dashboard (not /account/properties)
 * C2. UploadSuccess.tsx "View my orders" / dashboard CTA button targets /dashboard
 *     (note: the existing "Submit another listing" button stays at /upload — only
 *      the VIEW link is being added/fixed; we verify the /dashboard link exists)
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// ── Mock Supabase (needed by Status / UploadSuccess imports) ──────────────────
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi
        .fn()
        .mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
  AUTH_CALLBACK_URL: "http://localhost/auth/callback",
}));

// ── Mock API so Status doesn't actually poll ──────────────────────────────────
// Shape matches the updated fetchPropertyStatus return type: minimal fields
// always present, rich delivery fields present for authenticated owners/admins.
vi.mock("@/lib/api", () => ({
  fetchPropertyStatus: vi.fn().mockResolvedValue({
    status: "complete",
    label: "Delivered",
    currentStage: 6,
    totalStages: 6,
    // Rich fields (authenticated owner/admin path)
    address: "99 Test Street",
    horizontalVideoUrl: "https://cdn.example.com/vid.mp4",
    verticalVideoUrl: null,
    createdAt: new Date().toISOString(),
    processingTimeMs: 90000,
    clipsCompleted: 6,
    clipsTotal: 6,
  }),
}));

// ── Mock framer-motion (used by Status.tsx) ────────────────────────────────────
const mkEl = (tag: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({ children, ...props }: any) => React.createElement(tag, props, children);

vi.mock("framer-motion", () => ({
  motion: {
    div: mkEl("div"),
    section: mkEl("section"),
    span: mkEl("span"),
    li: mkEl("li"),
    ul: mkEl("ul"),
    p: mkEl("p"),
    article: mkEl("article"),
    header: mkEl("header"),
    footer: mkEl("footer"),
    a: mkEl("a"),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Mock SiteNav (used by UploadSuccess) ──────────────────────────────────────
vi.mock("@/v2/components/SiteNav", () => ({
  SiteNav: () => null,
}));

// ── Mock v2 CSS imports (not needed in test env) ──────────────────────────────
vi.mock("@/v2/styles/v2.css", () => ({}));

// ── Mock Lucide (used in Status and UploadSuccess) ────────────────────────────
vi.mock("lucide-react", () => ({
  ArrowLeft: () => <span>ArrowLeft</span>,
  ArrowRight: () => <span>ArrowRight</span>,
  Check: () => <span>Check</span>,
  Download: () => <span>Download</span>,
  Loader2: () => <span>Loader2</span>,
  AlertTriangle: () => <span>AlertTriangle</span>,
  Play: () => <span>Play</span>,
  CheckCircle2: () => <span>CheckCircle2</span>,
}));

// ── Mock shadcn Button ─────────────────────────────────────────────────────────
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => {
    if (asChild && React.isValidElement(children)) {
      return children;
    }
    return <button onClick={onClick} {...props}>{children}</button>;
  },
}));

describe("C1 — Status.tsx 'View all videos' link targets /dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Status page has a link whose href is /dashboard (not /account/properties)", async () => {
    // Dynamic import to respect mocks
    const { default: Status } = await import("@/pages/Status");
    const { Routes, Route } = await import("react-router-dom");
    const { container } = render(
      <MemoryRouter initialEntries={["/status/test-prop"]}>
        <Routes>
          <Route path="/status/:id" element={<Status />} />
        </Routes>
      </MemoryRouter>
    );
    // Wait for async data to load (fetchPropertyStatus is mocked to resolve)
    await new Promise((r) => setTimeout(r, 120));

    // Find all anchor/link elements
    const allLinks = Array.from(container.querySelectorAll("a"));
    const hrefs = allLinks.map((a) => a.getAttribute("href") ?? "");

    // The "view all" link must target /dashboard
    expect(hrefs).toContain("/dashboard");
    // It must NOT target the old /account/properties
    expect(hrefs).not.toContain("/account/properties");
  });
});

describe("C3 — Status.tsx delivered state renders video links (P1 regression guard)", () => {
  /**
   * Asserts that when fetchPropertyStatus returns rich delivery fields
   * (the authenticated owner/admin shape), the horizontal video link is rendered.
   * This guards against the P1 regression where the GET /status endpoint was
   * narrowed to 4 keys and Status.tsx still read the old camelCase fields.
   */
  it("renders a video link using horizontalVideoUrl when status is complete", async () => {
    const { default: Status } = await import("@/pages/Status");
    const { Routes, Route } = await import("react-router-dom");
    const { container } = render(
      <MemoryRouter initialEntries={["/status/test-prop"]}>
        <Routes>
          <Route path="/status/:id" element={<Status />} />
        </Routes>
      </MemoryRouter>
    );
    await new Promise((r) => setTimeout(r, 120));

    // The delivery section should contain an anchor pointing to the video URL
    const allLinks = Array.from(container.querySelectorAll("a"));
    const hrefs = allLinks.map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).toContain("https://cdn.example.com/vid.mp4");
  });

  it("renders the address heading when address is present in the response", async () => {
    const { default: Status } = await import("@/pages/Status");
    const { Routes, Route } = await import("react-router-dom");
    const { container } = render(
      <MemoryRouter initialEntries={["/status/test-prop"]}>
        <Routes>
          <Route path="/status/:id" element={<Status />} />
        </Routes>
      </MemoryRouter>
    );
    await new Promise((r) => setTimeout(r, 120));

    // The address should appear in a heading
    expect(container.textContent).toContain("99 Test Street");
  });

  it("does not crash when only minimal (unauthenticated) fields are returned", async () => {
    const { fetchPropertyStatus } = await import("@/lib/api");
    (fetchPropertyStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: "generating",
      label: "Rendering",
      currentStage: 3,
      totalStages: 6,
      // no rich fields — unauthenticated email link view
    });

    const { default: Status } = await import("@/pages/Status");
    const { Routes, Route } = await import("react-router-dom");
    const { container } = render(
      <MemoryRouter initialEntries={["/status/test-prop"]}>
        <Routes>
          <Route path="/status/:id" element={<Status />} />
        </Routes>
      </MemoryRouter>
    );
    await new Promise((r) => setTimeout(r, 120));

    // Should render the pipeline stepper without crashing
    expect(container.textContent).toContain("In production");
    // No video link when horizontalVideoUrl is absent
    const allLinks = Array.from(container.querySelectorAll("a"));
    const hrefs = allLinks.map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).not.toContain("https://cdn.example.com/vid.mp4");
  });
});

describe("C2 — UploadSuccess has a link/CTA targeting /dashboard", () => {
  it("UploadSuccess page contains a link to /dashboard", async () => {
    const { default: UploadSuccess } = await import("@/pages/UploadSuccess");
    const { container } = render(
      <MemoryRouter>
        <UploadSuccess />
      </MemoryRouter>
    );

    const allLinks = Array.from(container.querySelectorAll("a"));
    const hrefs = allLinks.map((a) => a.getAttribute("href") ?? "");

    expect(hrefs).toContain("/dashboard");
  });
});
