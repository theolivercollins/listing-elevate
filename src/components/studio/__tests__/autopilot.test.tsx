import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutopilotBadge } from '../AutopilotBadge';
import { AutopilotPanel, getPauseGuidance } from '../AutopilotPanel';

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

  it('renders decision log entries from ml_events with source=auto (realistic checkpoint_a payload)', async () => {
    authedFetch.mockImplementation(() =>
      jsonOk({
        ml_events: [
          {
            id: 'ev-1',
            event_type: 'auto_advance',
            payload: {
              source: 'auto',
              gate: 'checkpoint_a',
              confidence: 0.92,
              margins: [{ sceneId: 'scene-1', margin: 0.92 }],
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

    // Gate badge still shows
    expect(await screen.findByText('checkpoint_a')).toBeInTheDocument();
    // Human-readable summary for checkpoint_a
    expect(screen.getByText('Checkpoint A — confident (avg margin 0.92)')).toBeInTheDocument();
    // Confidence percentage still shows
    expect(screen.getByText('92% confidence')).toBeInTheDocument();
    // Operator event filtered out — its id never appears
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

  // ── FIX 1 — Enable from off ───────────────────────────────────────────────

  it('renders Enable autopilot button when autoRun is false', async () => {
    render(
      <AutopilotPanel
        runId="run-1"
        autoRun={false}
        pausedReason={null}
        autoPausedAt={null}
        onAction={onAction}
      />,
    );

    expect(await screen.findByTestId('autopilot-enable-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('autopilot-pause-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('autopilot-resume-btn')).not.toBeInTheDocument();
  });

  it('Enable button dispatches set_auto_run enabled:true', async () => {
    render(
      <AutopilotPanel
        runId="run-1"
        autoRun={false}
        pausedReason={null}
        autoPausedAt={null}
        onAction={onAction}
      />,
    );

    const btn = await screen.findByTestId('autopilot-enable-btn');
    fireEvent.click(btn);
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledWith({ action: 'set_auto_run', enabled: true }),
    );
  });

  // ── FIX 2 — Per-gate decision log summaries ───────────────────────────────

  it('decision log renders per-gate summaries from realistic payloads (voice, music, checkpoint_b)', async () => {
    authedFetch.mockImplementation(() =>
      jsonOk({
        ml_events: [
          {
            id: 'ev-vo',
            event_type: 'auto_advance',
            payload: {
              source: 'auto',
              gate: 'voiceover',
              confidence: 0.9,
              voice_id: 'alice',
              tone_pick: 'Warm',
            },
            created_at: '2026-06-26T10:00:00Z',
          },
          {
            id: 'ev-mu',
            event_type: 'auto_advance',
            payload: {
              source: 'auto',
              gate: 'music',
              confidence: 0.9,
              mood: 'upbeat',
              music_track_id: 'track-123',
            },
            created_at: '2026-06-26T10:01:00Z',
          },
          {
            id: 'ev-cb',
            event_type: 'auto_advance',
            payload: {
              source: 'auto',
              gate: 'checkpoint_b',
              confidence: 0.82,
              score: 0.82,
              confident_scenes: 3,
              degraded_scenes: 0,
            },
            created_at: '2026-06-26T10:02:00Z',
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

    expect(
      await screen.findByText('Voiceover — picked voice alice (Warm)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Music — mood upbeat, track track-123')).toBeInTheDocument();
    expect(screen.getByText('Checkpoint B — quality 0.82')).toBeInTheDocument();
  });

  it('decision log shows pause reason for auto_pause events', async () => {
    authedFetch.mockImplementation(() =>
      jsonOk({
        ml_events: [
          {
            id: 'ev-pause',
            event_type: 'auto_pause',
            payload: {
              source: 'auto',
              reason: 'low judge margin on scene abc: 0.080',
            },
            created_at: '2026-06-26T10:05:00Z',
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

    expect(
      await screen.findByText('low judge margin on scene abc: 0.080'),
    ).toBeInTheDocument();
  });

  // ── Task 3 — pause reason clarity + actionable guidance ───────────────────

  it('shows "Autopilot paused — needs your review" title and the reason + guidance line', async () => {
    render(
      <AutopilotPanel
        runId="run-1"
        autoRun={true}
        pausedReason="Final video scored 0.50 (needs 0.70): 4 of 7 scenes missing clips; listing details present; voiceover present; music present"
        autoPausedAt={null}
        onAction={onAction}
      />,
    );

    expect(await screen.findByText(/Autopilot paused — needs your review/)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Final video scored 0.50 (needs 0.70): 4 of 7 scenes missing clips; listing details present; voiceover present; music present',
      ),
    ).toBeInTheDocument();
    // The reason names missing clips → the actionable next step is fixing the
    // scenes, NOT reviewing at Checkpoint B (the real production incident).
    expect(
      screen.getByText('Generate or fix the missing scenes, then resume autopilot.'),
    ).toBeInTheDocument();
  });

  it('shows the missing-scenes guidance line for a "generation incomplete" pause reason', async () => {
    render(
      <AutopilotPanel
        runId="run-1"
        autoRun={true}
        pausedReason="generation incomplete: 2 of 7 scenes have no clip (scenes 3, 5)"
        autoPausedAt={null}
        onAction={onAction}
      />,
    );

    expect(
      await screen.findByText('Generate or fix the missing scenes, then resume autopilot.'),
    ).toBeInTheDocument();
  });

  it('renders unrecognized/legacy pause reasons as-is with the generic guidance (no throw)', async () => {
    render(
      <AutopilotPanel
        runId="run-1"
        autoRun={true}
        pausedReason="quality below threshold: 0.50 < 0.7"
        autoPausedAt={null}
        onAction={onAction}
      />,
    );

    expect(await screen.findByText('quality below threshold: 0.50 < 0.7')).toBeInTheDocument();
    expect(
      screen.getByText('Review the video at Checkpoint B, then resume or take over.'),
    ).toBeInTheDocument();
  });
});

// ─── getPauseGuidance (pure mapping function) ────────────────────────────────

describe('getPauseGuidance', () => {
  it('returns empty string for null/undefined reason', () => {
    expect(getPauseGuidance(null)).toBe('');
    expect(getPauseGuidance(undefined)).toBe('');
  });

  it('maps "generation incomplete" reasons to the missing-scenes guidance', () => {
    expect(getPauseGuidance('generation incomplete: 3 of 7 scenes have no clip (scenes 1, 2, 4)')).toBe(
      'Generate or fix the missing scenes, then resume autopilot.',
    );
  });

  it('maps composed quality-score reasons WITH a missing-clips clause to the missing-scenes guidance (real incident)', () => {
    expect(
      getPauseGuidance(
        'Final video scored 0.50 (needs 0.70): 4 of 7 scenes missing clips; listing details present; voiceover present; music present',
      ),
    ).toBe('Generate or fix the missing scenes, then resume autopilot.');
  });

  it('maps composed quality-score reasons WITHOUT a missing-clips clause to the Checkpoint B guidance', () => {
    // degradedCount 0 → composeCheckpointBReason omits the missing-clips clause
    expect(
      getPauseGuidance(
        'Final video scored 0.50 (needs 0.70): listing details missing; voiceover missing; music missing',
      ),
    ).toBe('Review the video at Checkpoint B, then resume or take over.');
  });

  it('falls back to the generic guidance for unrecognized/legacy reason strings without throwing', () => {
    expect(() => getPauseGuidance('some future reason format nobody has seen yet')).not.toThrow();
    expect(getPauseGuidance('some future reason format nobody has seen yet')).toBe(
      'Review the video at Checkpoint B, then resume or take over.',
    );
    expect(getPauseGuidance('low judge margin on scene abc: 0.080')).toBe(
      'Review the video at Checkpoint B, then resume or take over.',
    );
  });
});
