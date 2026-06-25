import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutopilotBadge } from '../AutopilotBadge';
import { AutopilotPanel } from '../AutopilotPanel';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const authedFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  authedFetch: (...args: unknown[]) => authedFetch(...args),
}));

vi.mock('@/lib/types', () => ({
  getRelativeTime: (s: string) => s,
  formatCents: (c: number) => `$${c}`,
}));

function jsonOk(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

// ─── AutopilotBadge ───────────────────────────────────────────────────────────

describe('AutopilotBadge', () => {
  it('shows live badge when not paused', () => {
    render(<AutopilotBadge paused={false} />);
    expect(screen.getByTestId('autopilot-badge-live')).toBeInTheDocument();
    expect(screen.getByText(/AI is running this listing/)).toBeInTheDocument();
  });

  it('shows paused badge when paused', () => {
    render(<AutopilotBadge paused={true} />);
    expect(screen.getByTestId('autopilot-badge-paused')).toBeInTheDocument();
    expect(screen.getByText(/needs you/)).toBeInTheDocument();
  });

  it('does not render live badge when paused', () => {
    render(<AutopilotBadge paused={true} />);
    expect(screen.queryByTestId('autopilot-badge-live')).not.toBeInTheDocument();
  });

  it('does not render paused badge when live', () => {
    render(<AutopilotBadge paused={false} />);
    expect(screen.queryByTestId('autopilot-badge-paused')).not.toBeInTheDocument();
  });
});

// ─── AutopilotPanel — action dispatch ────────────────────────────────────────

describe('AutopilotPanel', () => {
  const onAction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: delivery endpoint returns no ml_events
    authedFetch.mockImplementation(() => jsonOk({ ml_events: [] }));
    onAction.mockResolvedValue(undefined);
  });

  it('Pause button calls onAction with set_auto_run enabled:false', async () => {
    render(
      <AutopilotPanel
        runId="run-1"
        autoRun={true}
        pausedReason={null}
        autoPausedAt={null}
        onAction={onAction}
      />,
    );

    const btn = await screen.findByTestId('autopilot-pause-btn');
    fireEvent.click(btn);
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({ action: 'set_auto_run', enabled: false }),
    );
  });

  it('Resume button calls onAction with resume_autopilot', async () => {
    render(
      <AutopilotPanel
        runId="run-1"
        autoRun={true}
        pausedReason="Low-confidence scene ordering — human review needed"
        autoPausedAt={null}
        onAction={onAction}
      />,
    );

    const btn = await screen.findByTestId('autopilot-resume-btn');
    fireEvent.click(btn);
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({ action: 'resume_autopilot' }),
    );
  });

  it('shows paused banner with reason when pausedReason is set', async () => {
    render(
      <AutopilotPanel
        runId="run-1"
        autoRun={true}
        pausedReason="Checkpoint B rating below threshold"
        autoPausedAt={null}
        onAction={onAction}
      />,
    );

    expect(await screen.findByText('Checkpoint B rating below threshold')).toBeInTheDocument();
  });

  it('renders decision log entries from ml_events with source=auto', async () => {
    authedFetch.mockImplementation(() =>
      jsonOk({
        ml_events: [
          {
            id: 'ev-1',
            event_type: 'auto_advance',
            payload: {
              source: 'auto',
              gate: 'checkpoint_a',
              choice: 'advance',
              confidence: 0.92,
              reason: 'Scene order approved by AI.',
            },
            created_at: '2026-06-26T10:00:00Z',
          },
          {
            id: 'ev-2',
            event_type: 'voice_choice',
            payload: { source: 'operator' }, // should be filtered out
            created_at: '2026-06-26T10:01:00Z',
          },
        ],
      }),
    );

    render(
      <AutopilotPanel
        runId="run-1"
        autoRun={true}
        pausedReason={null}
        autoPausedAt={null}
        onAction={onAction}
      />,
    );

    // Only the 'auto' event should appear
    expect(await screen.findByText('checkpoint_a')).toBeInTheDocument();
    expect(screen.getByText('Scene order approved by AI.')).toBeInTheDocument();
    expect(screen.getByText('92% confidence')).toBeInTheDocument();
    // operator event should not appear
    expect(screen.queryByText('ev-2')).not.toBeInTheDocument();
  });

  it('shows "No autopilot decisions yet" when events list is empty', async () => {
    render(
      <AutopilotPanel
        runId="run-1"
        autoRun={true}
        pausedReason={null}
        autoPausedAt={null}
        onAction={onAction}
      />,
    );

    expect(await screen.findByText('No autopilot decisions yet.')).toBeInTheDocument();
  });
});
