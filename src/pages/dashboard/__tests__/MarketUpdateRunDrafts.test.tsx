/**
 * MarketUpdateRunDrafts.test.tsx
 *
 * Tests for the RunDetail draft panel — status badges, two-step confirmation
 * gating, and correct rail-endpoint calls.
 *
 * Uses happy-dom (vitest config), mocks fetch globally.
 * Never hits real publish/send endpoints.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => mockToastSuccess(...a),
    error: (...a: unknown[]) => mockToastError(...a),
  },
}));

// ─── Fetch mock helpers ────────────────────────────────────────────────────

type FetchHandlers = Record<string, () => unknown>;

const makeJsonFetch = (handlers: FetchHandlers) => {
  return vi.fn(async (url: string, opts?: RequestInit) => {
    const method = ((opts?.method ?? "GET") as string).toUpperCase();
    const matchingKey = Object.keys(handlers).find((k) => {
      const spaceIdx = k.indexOf(" ");
      const km = k.slice(0, spaceIdx);
      const ku = k.slice(spaceIdx + 1);
      return km === method && url === ku;
    });
    if (!matchingKey) {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "Not Found",
        json: async () => ({ error: "Not Found" }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => handlers[matchingKey](),
    } as unknown as Response;
  });
};

// ─── Shared test data ──────────────────────────────────────────────────────

const POST_ID_1 = "post-aaa-1111";
const POST_ID_2 = "post-bbb-2222";
const EMAIL_ID_1 = "email-ccc-3333";

const RUN_GENERATED = {
  id: "run-001",
  period_month: 5,
  period_year: 2026,
  status: "generated",
  blog_template_id: "tmpl-blog-1",
  email_template_id: "tmpl-email-1",
  region_results: [
    {
      region_slug: "charlotte_county",
      region_name: "Charlotte County",
      strip_images: false,
      emits_email: true,
      metrics: { metrics: {} },
      issues: [],
      post_id: POST_ID_1,
      email_id: EMAIL_ID_1,
    },
    {
      region_slug: "the_isles",
      region_name: "The Isles",
      strip_images: true,
      emits_email: false,
      metrics: { metrics: {} },
      issues: [],
      post_id: POST_ID_2,
      email_id: null,
    },
  ],
  created_post_ids: [POST_ID_1, POST_ID_2],
  created_email_ids: [EMAIL_ID_1],
  cost_usd_cents: 420,
  created_at: "2026-05-15T00:00:00Z",
  updated_at: "2026-05-15T00:00:00Z",
};

const POST_1_DRAFT = {
  post: {
    id: POST_ID_1,
    title: "Charlotte County Market Update — May 2026",
    state: "awaiting_approval",
    image: null,
    author_label: null,
    category_label: null,
    updated_at: "2026-05-15T00:00:00Z",
    cost_usd_cents: 200,
    external_post_url: null,
    authored: "auto",
  },
  jobs: [],
  cost_events: 1,
};

const POST_2_LIVE = {
  post: {
    id: POST_ID_2,
    title: "The Isles Market Update — May 2026",
    state: "live",
    image: null,
    author_label: null,
    category_label: null,
    updated_at: "2026-05-15T00:00:00Z",
    cost_usd_cents: 200,
    external_post_url: "https://example.com/isles",
    authored: "auto",
  },
  jobs: [],
  cost_events: 1,
};

const EMAIL_1_DRAFT = {
  email: {
    id: EMAIL_ID_1,
    subject: "Charlotte County Market Update — May 2026",
    state: "draft",
    preheader: null,
    audience: null,
    updated_at: "2026-05-15T00:00:00Z",
    sent_at: null,
    cost_usd_cents: 20,
    source_post_id: null,
    authored: "auto",
  },
};

const EMAIL_1_SENT = {
  email: { ...EMAIL_1_DRAFT.email, state: "sent", sent_at: "2026-05-15T10:00:00Z" },
};

// ─── Render helper ─────────────────────────────────────────────────────────

let MarketUpdatePage: React.ComponentType;

function renderRunDetail(fetchMock: ReturnType<typeof makeJsonFetch>) {
  vi.stubGlobal("fetch", fetchMock);

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/dashboard/studio/blog/market-update/run-001"]}>
        <Routes>
          <Route
            path="/dashboard/studio/blog/market-update/:id"
            element={<MarketUpdatePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("../MarketUpdate");
  MarketUpdatePage = mod.default;
  mockToastError.mockReset();
  mockToastSuccess.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("RunDetail — draft panels", () => {
  it("(a) renders status badges for each draft from API data", async () => {
    const fetchMock = makeJsonFetch({
      "GET /api/blog/market-update/runs/run-001": () => ({ run: RUN_GENERATED }),
      [`GET /api/blog/posts/${POST_ID_1}`]: () => POST_1_DRAFT,
      [`GET /api/blog/posts/${POST_ID_2}`]: () => POST_2_LIVE,
      [`GET /api/blog/emails/${EMAIL_ID_1}`]: () => EMAIL_1_DRAFT,
    });

    renderRunDetail(fetchMock);

    await waitFor(() => {
      expect(screen.getByTestId(`draft-panel-post-${POST_ID_1}`)).toBeTruthy();
    });

    const panel1 = screen.getByTestId(`draft-panel-post-${POST_ID_1}`);
    expect(panel1.textContent).toMatch(/draft/i);

    const panel2 = screen.getByTestId(`draft-panel-post-${POST_ID_2}`);
    expect(panel2.textContent).toMatch(/published/i);

    const emailPanel = screen.getByTestId(`draft-panel-email-${EMAIL_ID_1}`);
    expect(emailPanel.textContent).toMatch(/draft/i);
  });

  it("(b1) clicking Publish does NOT call the rail until confirmation is completed", async () => {
    const fetchMock = makeJsonFetch({
      "GET /api/blog/market-update/runs/run-001": () => ({ run: RUN_GENERATED }),
      [`GET /api/blog/posts/${POST_ID_1}`]: () => POST_1_DRAFT,
      [`GET /api/blog/posts/${POST_ID_2}`]: () => POST_2_LIVE,
      [`GET /api/blog/emails/${EMAIL_ID_1}`]: () => EMAIL_1_DRAFT,
    });

    renderRunDetail(fetchMock);

    await waitFor(() => {
      expect(screen.getByTestId(`draft-panel-post-${POST_ID_1}`)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId(`publish-btn-${POST_ID_1}`));

    // Rail NOT called
    const railCalls = (fetchMock.mock.calls as [string, RequestInit?][]).filter(
      ([url, opts]) =>
        url === `/api/blog/posts/${POST_ID_1}/publish` &&
        ((opts?.method ?? "GET") as string).toUpperCase() === "POST"
    );
    expect(railCalls).toHaveLength(0);

    // Confirm step must appear
    expect(screen.getByTestId(`publish-confirm-${POST_ID_1}`)).toBeTruthy();
  });

  it("(b2) confirming Publish calls the rail URL exactly once with POST", async () => {
    let publishCalled = 0;
    const fetchMock = makeJsonFetch({
      "GET /api/blog/market-update/runs/run-001": () => ({ run: RUN_GENERATED }),
      [`GET /api/blog/posts/${POST_ID_1}`]: () => POST_1_DRAFT,
      [`GET /api/blog/posts/${POST_ID_2}`]: () => POST_2_LIVE,
      [`GET /api/blog/emails/${EMAIL_ID_1}`]: () => EMAIL_1_DRAFT,
      [`POST /api/blog/posts/${POST_ID_1}/publish`]: () => {
        publishCalled++;
        return { job_id: "job-xyz" };
      },
    });

    renderRunDetail(fetchMock);

    await waitFor(() => {
      expect(screen.getByTestId(`draft-panel-post-${POST_ID_1}`)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId(`publish-btn-${POST_ID_1}`));
    fireEvent.click(screen.getByTestId(`publish-confirm-${POST_ID_1}`));

    await waitFor(() => expect(publishCalled).toBe(1));
  });

  it("(b3) clicking Send does NOT call the rail until confirmation is completed", async () => {
    const fetchMock = makeJsonFetch({
      "GET /api/blog/market-update/runs/run-001": () => ({ run: RUN_GENERATED }),
      [`GET /api/blog/posts/${POST_ID_1}`]: () => POST_1_DRAFT,
      [`GET /api/blog/posts/${POST_ID_2}`]: () => POST_2_LIVE,
      [`GET /api/blog/emails/${EMAIL_ID_1}`]: () => EMAIL_1_DRAFT,
    });

    renderRunDetail(fetchMock);

    await waitFor(() => {
      expect(screen.getByTestId(`draft-panel-email-${EMAIL_ID_1}`)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId(`send-btn-${EMAIL_ID_1}`));

    const sendCalls = (fetchMock.mock.calls as [string, RequestInit?][]).filter(
      ([url, opts]) =>
        url === `/api/blog/emails/${EMAIL_ID_1}/send` &&
        ((opts?.method ?? "GET") as string).toUpperCase() === "POST"
    );
    expect(sendCalls).toHaveLength(0);

    expect(screen.getByTestId(`send-confirm-${EMAIL_ID_1}`)).toBeTruthy();
  });

  it("(b4) confirming Send calls the rail URL exactly once with POST", async () => {
    let sendCalled = 0;
    const fetchMock = makeJsonFetch({
      "GET /api/blog/market-update/runs/run-001": () => ({ run: RUN_GENERATED }),
      [`GET /api/blog/posts/${POST_ID_1}`]: () => POST_1_DRAFT,
      [`GET /api/blog/posts/${POST_ID_2}`]: () => POST_2_LIVE,
      [`GET /api/blog/emails/${EMAIL_ID_1}`]: () => EMAIL_1_DRAFT,
      [`POST /api/blog/emails/${EMAIL_ID_1}/send`]: () => {
        sendCalled++;
        return { ok: true, message_id: "msg-1", sent_to_list_ids: [], sendy_response: "ok" };
      },
    });

    renderRunDetail(fetchMock);

    await waitFor(() => {
      expect(screen.getByTestId(`draft-panel-email-${EMAIL_ID_1}`)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId(`send-btn-${EMAIL_ID_1}`));
    fireEvent.click(screen.getByTestId(`send-confirm-${EMAIL_ID_1}`));

    await waitFor(() => expect(sendCalled).toBe(1));
  });

  it("(c) published/sent drafts show no action button", async () => {
    const fetchMock = makeJsonFetch({
      "GET /api/blog/market-update/runs/run-001": () => ({ run: RUN_GENERATED }),
      [`GET /api/blog/posts/${POST_ID_1}`]: () => POST_1_DRAFT,
      [`GET /api/blog/posts/${POST_ID_2}`]: () => POST_2_LIVE,
      [`GET /api/blog/emails/${EMAIL_ID_1}`]: () => EMAIL_1_SENT,
    });

    renderRunDetail(fetchMock);

    await waitFor(() => {
      expect(screen.getByTestId(`draft-panel-post-${POST_ID_2}`)).toBeTruthy();
    });

    expect(screen.queryByTestId(`publish-btn-${POST_ID_2}`)).toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId(`draft-panel-email-${EMAIL_ID_1}`)).toBeTruthy();
    });
    expect(screen.queryByTestId(`send-btn-${EMAIL_ID_1}`)).toBeNull();
  });
});
