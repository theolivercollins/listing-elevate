/**
 * PreviewPage component tests — TDD, failing first, then green.
 *
 * Spec §4: capability-conditional rendering, orientation toggle,
 * approved_at state, public kind hiding all action controls,
 * rendering-in-progress state, 404/expired state.
 *
 * Tests use MSW-free fetch stubbing (vi.stubGlobal) consistent with
 * the rest of the src/ test suite.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PreviewPage from '../PreviewPage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PreviewApiPayload = {
  address: string;
  address_parts: { street: string; locality: string };
  video_url: string | null;
  videos: { horizontal: string | null; vertical: string | null };
  thumbnail_url: string | null;
  brand: {
    logo: string | null;
    agent_name: string | null;
    name: string;
    headshot: string | null;
    brokerage: string | null;
  } | null;
  kind: 'client' | 'public';
  capabilities: { download: boolean; approve: boolean; revision: boolean };
  approved_at: string | null;
};

function makePayload(overrides: Partial<PreviewApiPayload> = {}): PreviewApiPayload {
  return {
    address: '123 Main St, Springfield, IL 62701, USA',
    address_parts: { street: '123 Main St', locality: 'Springfield, IL 62701' },
    video_url: 'https://cdn/h.mp4',
    videos: { horizontal: 'https://cdn/h.mp4', vertical: null },
    thumbnail_url: 'https://cdn/thumb.jpg',
    brand: null,
    kind: 'client',
    capabilities: { download: true, approve: true, revision: true },
    approved_at: null,
    ...overrides,
  };
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
}

function renderPreview(token = 'sometoken123') {
  return render(
    <MemoryRouter initialEntries={[`/preview/${token}`]}>
      <Routes>
        <Route path="/preview/:token" element={<PreviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Loading / 404 / expired states
// ---------------------------------------------------------------------------

describe('PreviewPage — 404 / expired state', () => {
  it('renders the expired/not-found state on 404 response', async () => {
    vi.stubGlobal('fetch', mockFetch(404, {}));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('preview-not-found')).toBeTruthy();
    });
  });

  it('expired state does not show action buttons', async () => {
    vi.stubGlobal('fetch', mockFetch(404, {}));
    renderPreview();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /request/i })).toBeNull();
    });
  });
});

describe('PreviewPage — rendering-in-progress state', () => {
  it('renders the in-progress state when video_url and videos are null', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({ video_url: null, videos: { horizontal: null, vertical: null } }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('preview-rendering')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Capability flags — Download
// ---------------------------------------------------------------------------

describe('PreviewPage — Download capability', () => {
  it('shows Download button when capabilities.download is true', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('btn-download')).toBeTruthy();
    });
  });

  it('hides Download button when capabilities.download is false', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, makePayload({ capabilities: { download: false, approve: true, revision: true } })),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.queryByTestId('btn-download')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Capability flags — Approve
// ---------------------------------------------------------------------------

describe('PreviewPage — Approve capability', () => {
  it('shows Approve button when capabilities.approve is true and not yet approved', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('btn-approve')).toBeTruthy();
    });
  });

  it('hides Approve button when capabilities.approve is false', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, makePayload({ capabilities: { download: true, approve: false, revision: true } })),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.queryByTestId('btn-approve')).toBeNull();
    });
  });

  it('shows "Approved" confirmed state instead of button when approved_at is set', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({ approved_at: '2026-06-11T10:00:00Z', capabilities: { download: true, approve: true, revision: true } }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      // Approve button replaced by a confirmed state
      expect(screen.queryByTestId('btn-approve')).toBeNull();
      expect(screen.getByTestId('approved-badge')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Capability flags — Request a change
// ---------------------------------------------------------------------------

describe('PreviewPage — Revision capability', () => {
  it('shows Request-a-change button when capabilities.revision is true', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('btn-request-change')).toBeTruthy();
    });
  });

  it('hides Request-a-change button when capabilities.revision is false', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, makePayload({ capabilities: { download: true, approve: true, revision: false } })),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.queryByTestId('btn-request-change')).toBeNull();
    });
  });

  it('reveals the note textarea when Request-a-change is clicked', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => screen.getByTestId('btn-request-change'));

    // Note box is hidden initially
    expect(screen.queryByTestId('change-note-box')).toBeNull();

    fireEvent.click(screen.getByTestId('btn-request-change'));
    expect(screen.getByTestId('change-note-box')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 5. Public kind — zero action buttons
// ---------------------------------------------------------------------------

describe('PreviewPage — public kind', () => {
  it('shows no action buttons (download/approve/request-change) for public links', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({
          kind: 'public',
          capabilities: { download: false, approve: false, revision: false },
        }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      // Page has loaded (has content)
      expect(screen.getByTestId('preview-address')).toBeTruthy();
    });
    // None of the action controls present
    expect(screen.queryByTestId('btn-download')).toBeNull();
    expect(screen.queryByTestId('btn-approve')).toBeNull();
    expect(screen.queryByTestId('btn-request-change')).toBeNull();
    expect(screen.queryByTestId('approved-badge')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Orientation toggle
// ---------------------------------------------------------------------------

describe('PreviewPage — orientation toggle', () => {
  it('does NOT show the orientation toggle when only horizontal exists', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, makePayload({ videos: { horizontal: 'https://cdn/h.mp4', vertical: null } })),
    );
    renderPreview();
    await waitFor(() => screen.getByTestId('preview-address'));
    expect(screen.queryByTestId('orientation-toggle')).toBeNull();
  });

  it('does NOT show the orientation toggle when only vertical exists', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, makePayload({ videos: { horizontal: null, vertical: 'https://cdn/v.mp4' }, video_url: 'https://cdn/v.mp4' })),
    );
    renderPreview();
    await waitFor(() => screen.getByTestId('preview-address'));
    expect(screen.queryByTestId('orientation-toggle')).toBeNull();
  });

  it('shows the orientation toggle when both horizontal and vertical exist', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({ videos: { horizontal: 'https://cdn/h.mp4', vertical: 'https://cdn/v.mp4' } }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('orientation-toggle')).toBeTruthy();
    });
  });

  it('swaps the video player src when toggle is clicked from Wide to Vertical', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({ videos: { horizontal: 'https://cdn/h.mp4', vertical: 'https://cdn/v.mp4' } }),
      ),
    );
    renderPreview();
    await waitFor(() => screen.getByTestId('orientation-toggle'));

    // Initially shows horizontal — re-query each time because key swap remounts
    expect((screen.getByTestId('video-player') as HTMLVideoElement).src).toContain('h.mp4');

    // Click the Vertical pill
    fireEvent.click(screen.getByTestId('toggle-vertical'));
    await waitFor(() => {
      expect((screen.getByTestId('video-player') as HTMLVideoElement).src).toContain('v.mp4');
    });

    // Click Wide again
    fireEvent.click(screen.getByTestId('toggle-wide'));
    await waitFor(() => {
      expect((screen.getByTestId('video-player') as HTMLVideoElement).src).toContain('h.mp4');
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Layout content — address, brand row, footer
// ---------------------------------------------------------------------------

describe('PreviewPage — layout', () => {
  it('renders the street address as the headline', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('preview-address')).toBeTruthy();
      expect(screen.getByTestId('preview-address').textContent).toContain('123 Main St');
    });
  });

  it('renders the locality as a quiet sub-line', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('preview-locality').textContent).toContain('Springfield, IL 62701');
    });
  });

  it('renders brand logo when brand.logo is present', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({ brand: { logo: 'https://cdn/logo.png', agent_name: 'Abby', name: 'Helgemo Team', headshot: null, brokerage: null } }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      const logo = screen.getByTestId('brand-logo') as HTMLImageElement;
      expect(logo.src).toContain('logo.png');
    });
  });

  it('renders typographic agent-name lockup when no logo', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({ brand: { logo: null, agent_name: 'Abby Smith', name: 'Helgemo Team', headshot: null, brokerage: null } }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.queryByTestId('brand-logo')).toBeNull();
      expect(screen.getByTestId('brand-name-lockup').textContent).toContain('Abby Smith');
    });
  });

  it('renders "Crafted with Listing Elevate" footer', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload()));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('footer-attribution').textContent).toContain('Listing Elevate');
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Presented-by row
// ---------------------------------------------------------------------------

describe('PreviewPage — presented-by row', () => {
  it('shows headshot when brand.headshot is present', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({
          brand: { logo: null, agent_name: 'Abby', name: 'Helgemo', headshot: 'https://cdn/head.jpg', brokerage: 'RE/MAX' },
        }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      const img = screen.getByTestId('agent-headshot') as HTMLImageElement;
      expect(img.src).toContain('head.jpg');
    });
  });

  it('shows brokerage name in presented-by row', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        200,
        makePayload({
          brand: { logo: null, agent_name: 'Abby', name: 'Helgemo', headshot: null, brokerage: 'Keller Williams' },
        }),
      ),
    );
    renderPreview();
    await waitFor(() => {
      expect(screen.getByTestId('presented-by-row').textContent).toContain('Keller Williams');
    });
  });

  it('does not render presented-by row when brand is null', async () => {
    vi.stubGlobal('fetch', mockFetch(200, makePayload({ brand: null })));
    renderPreview();
    await waitFor(() => screen.getByTestId('preview-address'));
    expect(screen.queryByTestId('presented-by-row')).toBeNull();
  });
});
